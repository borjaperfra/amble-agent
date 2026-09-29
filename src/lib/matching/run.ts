import { getDb } from '../db/db'
import { candidateById, listCapabilities, listListeningCandidateIds, now } from '../db/repo'
import { assessedOpportunityIds, hasAnyMatch, insertMatch, type MatchVerdict } from '../db/matching'
import { descriptionsOf, listCompanies, listOpenOpportunities } from '../db/opportunities'
import { BACKGROUND_SLOTS } from '../model/provider'
import { describeWhenMissing } from '../sourcing/describe'
import { runSourcing, syncDirectory, type SourcingStats } from '../sourcing/run'
import { DIRECTORY } from '../sourcing/directory'
import { normaliseName } from '../sourcing/text'
import { infoJobsConfigured, type InfoJobsQuery } from '../sourcing/infojobs'
import { theirStackConfigured, type TheirStackQuery } from '../sourcing/theirstack'
import { ASSESS_VERSION, assessOpportunity } from './assess'
import { buildMatchingProfile } from './profile'
import { EUROPE } from './places'
import { prefilter, roleQueryFor, type RoleQuery } from './role-query'

// Each assessment is a model call. A run reads at most this many new roles
// per candidate; the rest wait for the next run. It is a reading pace, not
// how many are shown: most of what is read is set aside.
const DEFAULT_LIMIT = 25
// As many at once as background work may have in flight; with several people
// the shared limit takes turns between them.
const CONCURRENCY = BACKGROUND_SLOTS
// A person's first read starts the moment they are listened for, not at the
// next scheduled pass: a larger batch, and only offers of the last two weeks,
// so what they see first is fresh. Older ones come in the regular passes.
const FIRST_READ_LIMIT = 60
const FIRST_READ_DAYS = 14
// A pass stops starting new reads before the next one is due (every 4 h);
// what is left waits for it.
const PASS_BUDGET_MS = 3.5 * 60 * 60 * 1000

export interface MatchingStats {
  profileHash: string
  open: number
  prefilterPassed: number
  prefilterOut: Record<string, number>
  alreadyAssessed: number
  assessedNow: number
  // Offers judged together with another city's posting of the same role.
  sharedAssessments: number
  verdicts: Record<MatchVerdict, number>
  waiting: number
  // Roles left for the next pass because this one ran out of time.
  outOfTime: number
  errors: { opportunity: string; message: string }[]
}

// An assessment belongs to a profile and to a version of the assessor.
export function currentMatchKey(candidateId: string): string {
  return `${buildMatchingProfile(candidateId).hash}:${ASSESS_VERSION}`
}

type OpenOpportunity = ReturnType<typeof listOpenOpportunities>[number]

// The first posting's text, or any other city's of the same role.
function descriptionOf(postings: OpenOpportunity[]): string | null {
  const texts = descriptionsOf(postings.map((posting) => posting.id))
  return texts.get(postings[0].id) ?? postings.map((posting) => texts.get(posting.id)).find(Boolean) ?? null
}

// `open` is shared by a whole pass: the offers are read once, not once per
// person, and without their text, which is read only for what is judged. Past `deadline`, no new read starts.
export async function runMatching(options: {
  candidateId: string
  limit?: number
  open?: OpenOpportunity[]
  deadline?: number
  // Only offers posted (or first seen) since this ISO date.
  since?: string
}): Promise<MatchingStats> {
  const candidate = candidateById(options.candidateId)
  const profile = buildMatchingProfile(candidate.id)
  const query = await roleQueryFor(candidate.id, profile)
  const matchKey = `${profile.hash}:${ASSESS_VERSION}`
  const assessed = assessedOpportunityIds(candidate.id, matchKey)

  const stats: MatchingStats = {
    profileHash: matchKey,
    open: 0,
    prefilterPassed: 0,
    prefilterOut: {},
    alreadyAssessed: 0,
    assessedNow: 0,
    sharedAssessments: 0,
    verdicts: { show: 0, hold: 0, discarded: 0 },
    waiting: 0,
    outOfTime: 0,
    errors: [],
  }

  const open = options.open ?? listOpenOpportunities()
  stats.open = open.length
  const pending: typeof open = []
  for (const opportunity of open) {
    if (options.since && (opportunity.posted_at ?? opportunity.first_seen_at) < options.since) continue
    const result = prefilter(opportunity, query)
    if (!result.pass) {
      const key = result.reason.split(':')[0]
      stats.prefilterOut[key] = (stats.prefilterOut[key] ?? 0) + 1
      continue
    }
    stats.prefilterPassed++
    if (assessed.has(opportunity.id)) stats.alreadyAssessed++
    else pending.push(opportunity)
  }

  // Offers that publish a salary go first: the candidate asked for them to be
  // prioritised, and they can be checked against the floor. Then newest.
  const hasSalary = (o: (typeof pending)[number]) => Number(Boolean(o.salary_raw || o.salary_min))
  pending.sort(
    (a, b) =>
      hasSalary(b) - hasSalary(a) || (b.posted_at ?? b.first_seen_at).localeCompare(a.posted_at ?? a.first_seen_at),
  )
  // One role posted in several cities is one judgment: the model reads it once,
  // with every city, and the verdict is kept on each posting. The shared model
  // run marks them as one role on the screen. Remote and on-site postings of a
  // title are different jobs, so the way of working is part of the role.
  const roles = new Map<string, typeof pending>()
  for (const opportunity of pending) {
    const key = `${opportunity.company_id}|${opportunity.title_norm}|${opportunity.workplace ?? ''}`
    roles.set(key, [...(roles.get(key) ?? []), opportunity])
  }
  const batch = [...roles.values()].slice(0, options.limit ?? DEFAULT_LIMIT)
  stats.waiting = pending.length - batch.reduce((sum, postings) => sum + postings.length, 0)

  const queue = [...batch]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let postings = queue.shift(); postings; postings = queue.shift()) {
        if (options.deadline !== undefined && Date.now() > options.deadline) {
          stats.outOfTime += 1 + queue.length
          queue.length = 0
          break
        }
        const [first] = postings
        const opportunity = {
          ...first,
          location: [...new Set(postings.map((posting) => posting.location).filter(Boolean))].join(' · ') || null,
          description: descriptionOf(postings),
        }
        try {
          // Some boards list offers without their text: read it now, before judging.
          if (!opportunity.description) opportunity.description = await describeWhenMissing(first.id)
          const assessment = await assessOpportunity({ candidateId: candidate.id, opportunity, profile, query })
          for (const posting of postings) {
            insertMatch({
              candidateId: candidate.id,
              opportunityId: posting.id,
              profileHash: matchKey,
              verdict: assessment.verdict,
              gates: assessment.gates,
              explanation: assessment.explanation,
              dropped: assessment.dropped,
              modelRunId: assessment.modelRunId,
            })
          }
          stats.assessedNow++
          stats.sharedAssessments += postings.length - 1
          stats.verdicts[assessment.verdict]++
        } catch (error) {
          stats.errors.push({
            opportunity: `${first.company_name} · ${first.title}`,
            message: error instanceof Error ? error.message : 'unknown error',
          })
        }
      }
    }),
  )

  return stats
}

// The same query that filters the watched boards narrows the aggregator
// search, so TheirStack credits are only spent on offers that could pass.
export function theirStackQueryFrom(query: RoleQuery): TheirStackQuery {
  // Every returned offer costs a credit, so the search is narrower than the
  // prefilter: a term that is part of an exclusion ("developer" inside
  // "software developer") would pull in the very offers the exclusion drops.
  const titleAny = query.titleInclude.filter((term) => !query.titleExclude.some((excluded) => excluded.includes(term)))
  // Countries a hard filter rules out, when the role query names them.
  const countryNot = [
    ...new Set(query.locationExclude.map((place) => COUNTRY_CODES[place]).filter((code): code is string => Boolean(code))),
  ]
  return {
    titleAny: titleAny.slice(0, 20),
    // The profile's exclusions first, then the gig and internship forms that
    // aggregators are full of, in the languages of the region searched.
    titleNot: [...new Set([...query.titleExclude.slice(0, 30), ...NOT_EMPLOYMENT])],
    workplaces: query.requireRemote ? ['remote'] : undefined,
    // Remote work is realistic within the candidate's region: Europe for
    // someone living in Europe, otherwise their own country.
    countryCodes: query.homeCountry ? (EUROPE.includes(query.homeCountry) ? EUROPE : [query.homeCountry]) : undefined,
    countryNot: countryNot.length > 0 ? countryNot : undefined,
    seniority: query.seniority.length > 0 ? query.seniority : undefined,
    // Domain rules: agencies re-post offers, and tiny outfits are mostly gigs.
    directEmployersOnly: true,
    minEmployees: 10,
    maxAgeDays: 14,
    limit: 50,
  }
}

// Not about the candidate: about the form of the job. Aggregators return
// freelance gigs, internships and working-student posts under any title.
const NOT_EMPLOYMENT = [
  'freelance',
  'freelancer',
  'evaluator',
  'werkstudent',
  'praktikum',
  'praktikant',
  'stagiaire',
  'alternance',
  'tirocinio',
  'collaborazione',
  'p iva',
  'becario',
  'practicas',
]

// Country names as they appear (normalised) in role-query location terms.
const COUNTRY_CODES: Record<string, string> = {
  'united states': 'US',
  usa: 'US',
  'u s': 'US',
  'u s a': 'US',
  'estados unidos': 'US',
  eeuu: 'US',
  'ee uu': 'US',
  canada: 'CA',
  'united kingdom': 'GB',
  uk: 'GB',
  india: 'IN',
  australia: 'AU',
  singapore: 'SG',
  germany: 'DE',
  france: 'FR',
}

// Each person's role query, for those whose profile is weighed.
async function listeningQueries(): Promise<Map<string, RoleQuery>> {
  const queries = new Map<string, RoleQuery>()
  for (const candidateId of listListeningCandidateIds()) {
    if (listCapabilities(candidateId).length === 0) continue
    queries.set(candidateId, await roleQueryFor(candidateId, buildMatchingProfile(candidateId)))
  }
  return queries
}

// Boards are free and read on every pass. The aggregator costs a credit per
// offer returned, so it runs on a daily budget, shared out in turns: each
// person's own query at most every few days, those searched longest ago
// first. What it brings in is read for everyone.
const THEIRSTACK_DAILY_CREDITS = Math.max(0, Number(process.env.AMBLE_THEIRSTACK_DAILY_CREDITS) || 100)
const THEIRSTACK_EVERY_DAYS = Math.max(1, Number(process.env.AMBLE_THEIRSTACK_EVERY_DAYS) || 3)
const THEIRSTACK_PER_SEARCH = 40

// InfoJobs costs nothing: each person's query once a day, words from their titles.
const INFOJOBS_EVERY_HOURS = 20

function dueInfoJobsSearches(queries: Map<string, RoleQuery>): { candidateId: string; query: InfoJobsQuery }[] {
  const since = new Date(Date.now() - INFOJOBS_EVERY_HOURS * 60 * 60 * 1000).toISOString()
  const recent = new Set(
    (getDb().prepare("SELECT DISTINCT candidate_id FROM source_searches WHERE source = 'infojobs' AND searched_at >= ?").all(since) as unknown as { candidate_id: string }[]).map(
      (row) => row.candidate_id,
    ),
  )
  return [...queries.entries()]
    .filter(([candidateId, query]) => !recent.has(candidateId) && query.titleInclude.length > 0)
    .map(([candidateId, query]) => ({ candidateId, query: { terms: query.titleInclude.filter((term) => term.includes(' ') || term.length > 6).slice(0, 5) } }))
    .filter((search) => search.query.terms.length > 0)
}

async function dueTheirStackSearches(): Promise<{ candidateId: string; query: TheirStackQuery }[]> {
  const db = getDb()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const spent = (db.prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM source_searches WHERE source = 'theirstack' AND searched_at >= ?").get(since) as { n: number }).n
  let budget = THEIRSTACK_DAILY_CREDITS - spent
  const last = new Map(
    (db.prepare("SELECT candidate_id, MAX(searched_at) AS at FROM source_searches WHERE source = 'theirstack' GROUP BY candidate_id").all() as unknown as { candidate_id: string; at: string }[]).map(
      (row) => [row.candidate_id, Date.parse(row.at)],
    ),
  )
  const due = listListeningCandidateIds()
    .filter((id) => Date.now() - (last.get(id) ?? 0) >= THEIRSTACK_EVERY_DAYS * 24 * 60 * 60 * 1000)
    .sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0))
  const searches: { candidateId: string; query: TheirStackQuery }[] = []
  for (const candidateId of due) {
    if (budget < 10) break
    // Not before what they shared is weighed: the query comes from it.
    if (listCapabilities(candidateId).length === 0) continue
    const limit = Math.min(THEIRSTACK_PER_SEARCH, budget)
    const query = theirStackQueryFrom(await roleQueryFor(candidateId, buildMatchingProfile(candidateId)))
    searches.push({ candidateId, query: { ...query, limit } })
    budget -= limit
  }
  return searches
}

export type CandidatePass = { candidateId: string } & ({ stats: MatchingStats } | { error: string })

// One listening pass: read the sources once, then judge what is new for each
// person the Rep listens for, against their own profile. Everyone is judged at
// the same time, taking turns at the model's shared limit, so no one waits for
// the people before them. One person's failure does not stop the others.
//
export async function runListening(options: { limit?: number } = {}): Promise<{ sourcing: SourcingStats; matching: CandidatePass[] }> {
  // Boards pinned in the directory since the last pass start being read now.
  const known = new Map(listCompanies().map((company) => [company.name_norm, company.status]))
  const pinnedNew = DIRECTORY.filter((entry) => entry.board && known.get(normaliseName(entry.name)) !== 'watching')
  if (pinnedNew.length > 0) await syncDirectory({ entries: pinnedNew, refresh: true }).catch(() => undefined)

  const searches = theirStackConfigured() ? await dueTheirStackSearches().catch(() => []) : []
  const infojobs = infoJobsConfigured() ? dueInfoJobsSearches(await listeningQueries().catch(() => new Map())) : []
  const sourcing = await runSourcing({ theirstack: searches.map((search) => search.query), infojobs: infojobs.map((search) => search.query) })
  // Spent as asked: what each search could return.
  const record = getDb().prepare('INSERT INTO source_searches (source, candidate_id, searched_at, credits) VALUES (?, ?, ?, ?)')
  for (const search of searches) record.run('theirstack', search.candidateId, now(), search.query.limit)
  for (const search of infojobs) record.run('infojobs', search.candidateId, now(), 0)

  const open = listOpenOpportunities()
  const deadline = Date.now() + PASS_BUDGET_MS
  // Someone whose first read is still running is left to it.
  const matching = await Promise.all(
    listListeningCandidateIds().filter((candidateId) => !firstReads.running.has(candidateId)).map(async (candidateId): Promise<CandidatePass> => {
      try {
        return { candidateId, stats: await runMatching({ candidateId, limit: options.limit, open, deadline }) }
      } catch (error) {
        return { candidateId, error: error instanceof Error ? error.message : 'matching failed' }
      }
    }),
  )
  return { sourcing, matching }
}

declare global {
  var __ambleFirstReads: { running: Set<string>; done: Set<string> } | undefined
}

// On globalThis: the pages and the scheduled pass are separate bundles in one
// process. `done` saves reloading every offer on each visit of someone whose
// first read found nothing; after a restart it is checked once more.
const firstReads = (globalThis.__ambleFirstReads ??= { running: new Set(), done: new Set() })

export function isFirstReading(candidateId: string): boolean {
  return firstReads.running.has(candidateId)
}

// Starts a person's first read in the background, when they are listened for
// and nothing has ever been judged for them. True while it is running.
export function startFirstRead(candidateId: string): boolean {
  if (firstReads.running.has(candidateId)) return true
  if (firstReads.done.has(candidateId)) return false
  if (hasAnyMatch(candidateId)) {
    firstReads.done.add(candidateId)
    return false
  }
  if (!listListeningCandidateIds().includes(candidateId)) return false
  // Not before what they shared is weighed: offers are judged against it.
  if (listCapabilities(candidateId).length === 0) return false
  firstReads.running.add(candidateId)
  const since = new Date(Date.now() - FIRST_READ_DAYS * 24 * 60 * 60 * 1000).toISOString()
  void runMatching({ candidateId, limit: FIRST_READ_LIMIT, since })
    .then((stats) => console.log(`[listen] first read for ${candidateId}: ${JSON.stringify({ ...stats, prefilterOut: undefined })}`))
    .catch((error) => console.error(`[listen] first read for ${candidateId} failed:`, error))
    .finally(() => {
      firstReads.running.delete(candidateId)
      firstReads.done.add(candidateId)
      // If their WhatsApp is linked, the best of it goes there.
      void import('../whatsapp/offers').then(({ sendDueOffers }) => sendDueOffers(candidateId)).catch(() => undefined)
    })
  return true
}
