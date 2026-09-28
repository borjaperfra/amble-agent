import { candidateById, getOrCreateCandidate, listListeningCandidateIds } from '../db/repo'
import { assessedOpportunityIds, insertMatch, type MatchVerdict } from '../db/matching'
import { lastTheirStackSearchAt, listOpenOpportunities } from '../db/opportunities'
import { runSourcing, type SourcingStats } from '../sourcing/run'
import type { TheirStackQuery } from '../sourcing/theirstack'
import { ASSESS_VERSION, assessOpportunity } from './assess'
import { buildMatchingProfile } from './profile'
import { EUROPE } from './places'
import { prefilter, roleQueryFor, type RoleQuery } from './role-query'

// Each assessment is a model call. A run reads at most this many new roles
// per candidate; the rest wait for the next run. It is a reading pace, not
// how many are shown: most of what is read is set aside.
const DEFAULT_LIMIT = 25
const CONCURRENCY = 3

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
  errors: { opportunity: string; message: string }[]
}

// An assessment belongs to a profile and to a version of the assessor.
export function currentMatchKey(candidateId: string): string {
  return `${buildMatchingProfile(candidateId).hash}:${ASSESS_VERSION}`
}

export async function runMatching(options: { candidateId: string; limit?: number }): Promise<MatchingStats> {
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
    errors: [],
  }

  const open = listOpenOpportunities()
  stats.open = open.length
  const pending: typeof open = []
  for (const opportunity of open) {
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
        const [first] = postings
        const opportunity = {
          ...first,
          location: [...new Set(postings.map((posting) => posting.location).filter(Boolean))].join(' · ') || null,
          description: first.description ?? postings.find((posting) => posting.description)?.description ?? null,
        }
        try {
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

// Boards are free and read on every pass; the aggregator costs a credit per
// offer and its search already spans two weeks, so it runs once a day.
const THEIRSTACK_EVERY_HOURS = 20

export type CandidatePass = { candidateId: string } & ({ stats: MatchingStats } | { error: string })

// One listening pass: read the sources once, then judge what is new for each
// person the Rep listens for, against their own profile. One person's failure
// does not stop the others.
//
// The aggregator is searched with the owner's query only, for now: it costs
// credits for every offer it returns, and the boards cost nothing.
export async function runListening(options: { limit?: number } = {}): Promise<{ sourcing: SourcingStats; matching: CandidatePass[] }> {
  const owner = getOrCreateCandidate()
  const query = await roleQueryFor(owner.id, buildMatchingProfile(owner.id))
  const last = lastTheirStackSearchAt()
  const aggregatorDue = !last || Date.now() - Date.parse(last) >= THEIRSTACK_EVERY_HOURS * 60 * 60 * 1000
  const sourcing = await runSourcing({ theirstack: aggregatorDue ? theirStackQueryFrom(query) : null })

  const matching: CandidatePass[] = []
  for (const candidateId of listListeningCandidateIds()) {
    try {
      matching.push({ candidateId, stats: await runMatching({ candidateId, limit: options.limit }) })
    } catch (error) {
      matching.push({ candidateId, error: error instanceof Error ? error.message : 'matching failed' })
    }
  }
  return { sourcing, matching }
}
