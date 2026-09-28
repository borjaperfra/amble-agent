import { inTransaction } from '../db/db'
import { applyRetention, type RetentionStats } from '../db/retention'
import { now } from '../db/repo'
import {
  closeMissing,
  countOpportunities,
  finishSourcingRun,
  listCompanies,
  recordCompanyFetch,
  clearCompanyBoard,
  getCompany,
  recordSighting,
  setCompanyDirectoryInfo,
  startSourcingRun,
  upsertCompany,
  type CompanyRow,
} from '../db/opportunities'
import { detectBoard, readAtsBoard, type DetectedBoard } from './ats'
import { DIRECTORY, type DirectoryEntry } from './directory'
import { searchTheirStack, theirStackConfigured, type TheirStackQuery } from './theirstack'
import { normaliseName } from './text'
import { SourceError, type AtsKind, type RawOpportunity } from './types'

// A read never stalls on one slow board, and never hammers the APIs either.
const CONCURRENCY = 4

export interface SourcingStats {
  companiesRead: number
  boardsMissing: string[]
  seen: number
  created: number
  closed: number
  theirstack: { ran: boolean; returned: number; newCompanies: number } | null
  retention: RetentionStats | null
  totals: { open: number; closed: number; companies: number }
  errors: { company?: string; source: string; message: string }[]
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item)
    }),
  )
}

async function store(raws: RawOpportunity[], companyId: string, seenAt: string): Promise<{ seen: number; created: number }> {
  let created = 0
  inTransaction(() => {
    for (const raw of raws) if (recordSighting(raw, companyId, seenAt).created) created++
  })
  return { seen: raws.length, created }
}

export async function runSourcing(options: { theirstack?: TheirStackQuery | null } = {}): Promise<SourcingStats> {
  const runId = startSourcingRun()
  const stats: SourcingStats = {
    companiesRead: 0,
    boardsMissing: [],
    seen: 0,
    created: 0,
    closed: 0,
    theirstack: null,
    retention: null,
    totals: { open: 0, closed: 0, companies: 0 },
    errors: [],
  }
  const errors = stats.errors

  const watched = listCompanies('watching').filter((company) => company.ats && company.ats_token)
  await pool(watched, async (company: CompanyRow) => {
    const seenAt = now()
    try {
      const raws = await readAtsBoard(company.ats as AtsKind, company.ats_token as string, company.name)
      if (raws === null) {
        // The board is gone (renamed or moved ATS). Nothing is closed on a
        // missing board: absence of evidence is not closure.
        stats.boardsMissing.push(company.name)
        recordCompanyFetch(company.id, `No ${company.ats} board "${company.ats_token}" any more`)
        return
      }
      const result = await store(raws, company.id, seenAt)
      stats.seen += result.seen
      stats.created += result.created
      stats.closed += closeMissing(company.id, company.ats as string, new Set(raws.map((raw) => raw.externalId)), seenAt)
      stats.companiesRead++
      recordCompanyFetch(company.id, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      errors.push({ company: company.name, source: company.ats as string, message })
      recordCompanyFetch(company.id, message)
    }
  })

  if (options.theirstack && theirStackConfigured()) {
    stats.theirstack = { ran: true, returned: 0, newCompanies: 0 }
    try {
      const raws = await searchTheirStack(options.theirstack)
      stats.theirstack.returned = raws.length
      const seenAt = now()
      const before = new Set(listCompanies().map((company) => company.id))
      // A search is not a full listing: nothing is ever closed from its absence.
      for (const raw of raws) {
        const company = upsertCompany({
          name: raw.companyName,
          domain: raw.companyDomain ?? null,
          status: 'unresolved',
          discoveredVia: 'theirstack',
        })
        if (!before.has(company.id)) stats.theirstack.newCompanies++
        const result = await store([raw], company.id, seenAt)
        stats.seen += result.seen
        stats.created += result.created
      }
    } catch (error) {
      errors.push({ source: 'theirstack', message: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  // Every read also forgets what is no longer worth keeping (src/lib/db/retention.ts).
  try {
    stats.retention = applyRetention()
  } catch (error) {
    errors.push({ source: 'retention', message: error instanceof Error ? error.message : 'unknown error' })
  }

  stats.totals = countOpportunities()
  finishSourcingRun(runId, stats, errors)
  return stats
}

export interface WatchResult {
  company: CompanyRow
  board: DetectedBoard | null
}

// Adding a company means finding where its offers live. If no board is found
// it is kept as unresolved: known, but not read (aggregators may still cover it).
export async function watchCompany(params: { name: string; careersUrl?: string | null; domain?: string | null; discoveredVia?: string }): Promise<WatchResult> {
  const board = await detectBoard(params).catch((error) => {
    if (error instanceof SourceError) return null
    throw error
  })
  const company = upsertCompany({
    name: params.name,
    domain: params.domain ?? null,
    careersUrl: params.careersUrl ?? null,
    ats: board?.ats ?? null,
    atsToken: board?.token ?? null,
    status: board ? 'watching' : 'unresolved',
    discoveredVia: params.discoveredVia ?? 'manual',
  })
  return { company, board }
}

export interface DirectoryStats {
  entries: number
  watching: number
  resolvedNow: string[]
  unresolved: string[]
  errors: { company: string; message: string }[]
}

// Brings the directory into the database. A company whose board is already
// known is only relabelled; the others are resolved (a pinned board is checked,
// the rest detected). refresh resolves every entry again.
export async function syncDirectory(options: { refresh?: boolean; entries?: DirectoryEntry[] } = {}): Promise<DirectoryStats> {
  const entries = options.entries ?? DIRECTORY
  const stats: DirectoryStats = { entries: entries.length, watching: 0, resolvedNow: [], unresolved: [], errors: [] }
  const known = new Map(listCompanies().map((company) => [company.name_norm, company]))

  await pool(entries, async (entry) => {
    try {
      let company = known.get(normaliseName(entry.name))
      if (!company || !company.ats || options.refresh) {
        if (entry.board) {
          const jobs = await readAtsBoard(entry.board.ats, entry.board.token, entry.name)
          if (!jobs && company?.ats) clearCompanyBoard(company.id)
          company = upsertCompany({
            name: entry.name,
            domain: entry.domain,
            careersUrl: entry.careersUrl ?? null,
            ats: jobs ? entry.board.ats : null,
            atsToken: jobs ? entry.board.token : null,
            status: jobs ? 'watching' : 'unresolved',
            discoveredVia: company?.discovered_via ?? 'directory',
          })
        } else {
          const result = await watchCompany({
            name: entry.name,
            domain: entry.domain,
            careersUrl: entry.careersUrl ?? `https://${entry.domain}/careers`,
            discoveredVia: company?.discovered_via ?? 'directory',
          })
          company = result.company
          if (!result.board && company.ats) {
            clearCompanyBoard(company.id)
            company = getCompany(company.id) as CompanyRow
          }
        }
        if (company.status === 'watching') stats.resolvedNow.push(entry.name)
      }
      setCompanyDirectoryInfo(company.id, entry.segment, Boolean(entry.publicSalary))
      if (company.status === 'watching') stats.watching++
      else stats.unresolved.push(entry.name)
    } catch (error) {
      stats.errors.push({ company: entry.name, message: error instanceof Error ? error.message : 'unknown error' })
    }
  })
  return stats
}
