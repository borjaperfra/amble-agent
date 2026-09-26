import { runInTransaction } from '../db/db'
import { now } from '../db/repo'
import {
  closeMissing,
  countOpportunities,
  finishSourcingRun,
  listCompanies,
  recordCompanyFetch,
  recordSighting,
  startSourcingRun,
  upsertCompany,
  type CompanyRow,
} from '../db/opportunities'
import { detectBoard, readAtsBoard, type DetectedBoard } from './ats'
import { searchTheirStack, theirStackConfigured, type TheirStackQuery } from './theirstack'
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
  await runInTransaction(async () => {
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
