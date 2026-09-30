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
import { infoJobsConfigured, searchInfoJobs, type InfoJobsQuery } from './infojobs'
import { searchTheirStack, theirStackConfigured, type TheirStackQuery } from './theirstack'
import { normaliseName } from './text'
import { SourceError, type AtsKind, type RawOpportunity } from './types'

// A read never stalls on one slow board, and never hammers the APIs either:
// several boards at once, but only a few on any one ATS (most serve every
// company from the same API host). Workable answered a burst with a day-long
// ban (ats.ts), and BambooHR reads a detail per offer: two at a time there.
const CONCURRENCY = 16
const PER_ATS = 4
const DIRECTORY_CONCURRENCY = 4
const PER_ATS_LIMIT: Partial<Record<AtsKind, number>> = { workable: 2, bamboohr: 2, successfactors: 2 }
// Paged boards (Workday, SmartRecruiters) take longest: started first, they
// do not become the pass's tail.
const FIRST: AtsKind[] = ['workday', 'smartrecruiters', 'bamboohr']

export interface SourcingStats {
  companiesRead: number
  boardsMissing: string[]
  seen: number
  created: number
  closed: number
  theirstack: { ran: boolean; returned: number; newCompanies: number } | null
  infojobs?: { ran: boolean; returned: number; newCompanies: number } | null
  retention: RetentionStats | null
  totals: { open: number; closed: number; companies: number }
  errors: { company?: string; source: string; message: string }[]
}

// Runs worker over every item, at most `limit` at once and at most
// `limitOf(key)` at once for any one key.
async function pool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  options: { limit: number; keyOf?: (item: T) => string; limitOf?: (key: string) => number },
): Promise<void> {
  const keyOf = options.keyOf ?? (() => '')
  const limitOf = options.limitOf ?? (() => options.limit)
  const queue = [...items]
  const running = new Map<string, number>()
  let active = 0
  await new Promise<void>((resolve) => {
    const next = () => {
      if (queue.length === 0 && active === 0) return resolve()
      for (let index = 0; index < queue.length && active < options.limit; ) {
        const key = keyOf(queue[index])
        if ((running.get(key) ?? 0) >= limitOf(key)) {
          index++
          continue
        }
        const [item] = queue.splice(index, 1)
        active++
        running.set(key, (running.get(key) ?? 0) + 1)
        // A worker handles its own failures; one that throws still frees its place.
        void worker(item)
          .catch(() => undefined)
          .finally(() => {
            active--
            running.set(key, (running.get(key) ?? 0) - 1)
            next()
          })
      }
    }
    next()
  })
}

function store(raws: RawOpportunity[], companyId: string, seenAt: string): { seen: number; created: number } {
  let created = 0
  for (const raw of raws) if (recordSighting(raw, companyId, seenAt).created) created++
  return { seen: raws.length, created }
}

// A search is not a full listing: its offers are stored, and nothing is ever
// closed from their absence. Its companies are kept as unresolved.
function storeSearch(
  raws: RawOpportunity[],
  discoveredVia: 'theirstack' | 'infojobs',
  stats: SourcingStats,
): { ran: boolean; returned: number; newCompanies: number } {
  const result = { ran: true, returned: raws.length, newCompanies: 0 }
  const seenAt = now()
  const known = new Set(listCompanies().map((company) => company.id))
  inTransaction(() => {
    for (const raw of raws) {
      const company = upsertCompany({
        name: raw.companyName,
        domain: discoveredVia === 'theirstack' ? (raw.companyDomain ?? null) : null,
        status: 'unresolved',
        discoveredVia,
      })
      if (!known.has(company.id)) {
        known.add(company.id)
        result.newCompanies++
      }
      const stored = store([raw], company.id, seenAt)
      stats.seen += stored.seen
      stats.created += stored.created
    }
  })
  return result
}

// Every search at once; one that fails loses only its own results (a
// TheirStack search already paid for is kept even if another one failed).
async function searchAll<Q>(queries: Q[], search: (query: Q) => Promise<RawOpportunity[]>): Promise<{ raws: RawOpportunity[]; errors: string[] }> {
  const settled = await Promise.allSettled(queries.map((query) => search(query)))
  return {
    raws: settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    errors: settled.flatMap((result) => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : 'unknown error'] : [])),
  }
}

// `theirstack`: the aggregator searches for this pass, one per person due one.
export async function runSourcing(options: { theirstack?: TheirStackQuery[]; infojobs?: InfoJobsQuery[] } = {}): Promise<SourcingStats> {
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

  // The searches go out while the boards are read (other hosts entirely);
  // what they bring is stored after the boards, in the same order as ever.
  const theirstack = options.theirstack?.length && theirStackConfigured() ? searchAll(options.theirstack, searchTheirStack) : null
  const infojobs = options.infojobs?.length && infoJobsConfigured() ? searchAll(options.infojobs, searchInfoJobs) : null

  const watched = listCompanies('watching')
    .filter((company) => company.ats && company.ats_token)
    .sort((a, b) => Number(FIRST.includes(b.ats as AtsKind)) - Number(FIRST.includes(a.ats as AtsKind)))
  await pool(
    watched,
    async (company: CompanyRow) => {
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
        // One write for the whole board: what it lists, what it no longer
        // lists, and when it was read.
        inTransaction(() => {
          const result = store(raws, company.id, seenAt)
          stats.seen += result.seen
          stats.created += result.created
          stats.closed += closeMissing(company.id, company.ats as string, new Set(raws.map((raw) => raw.externalId)), seenAt)
          recordCompanyFetch(company.id, null)
        })
        stats.companiesRead++
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        errors.push({ company: company.name, source: company.ats as string, message })
        recordCompanyFetch(company.id, message)
      }
    },
    { limit: CONCURRENCY, keyOf: (company) => company.ats as string, limitOf: (ats) => PER_ATS_LIMIT[ats as AtsKind] ?? PER_ATS },
  )

  for (const [source, searching] of [
    ['theirstack', theirstack],
    ['infojobs', infojobs],
  ] as const) {
    if (!searching) continue
    const { raws, errors: failed } = await searching
    for (const message of failed) errors.push({ source, message })
    try {
      stats[source] = storeSearch(raws, source, stats)
    } catch (error) {
      stats[source] = { ran: true, returned: raws.length, newCompanies: 0 }
      errors.push({ source, message: error instanceof Error ? error.message : 'unknown error' })
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

  await pool(
    entries,
    async (entry) => {
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
    },
    // Resolving a company probes several ATSs for it: a few companies at a time.
    { limit: DIRECTORY_CONCURRENCY },
  )
  return stats
}
