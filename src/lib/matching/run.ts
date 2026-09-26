import { getOrCreateCandidate } from '../db/repo'
import { assessedOpportunityIds, insertMatch, type MatchVerdict } from '../db/matching'
import { listOpenOpportunities } from '../db/opportunities'
import { runSourcing, type SourcingStats } from '../sourcing/run'
import type { TheirStackQuery } from '../sourcing/theirstack'
import { ASSESS_VERSION, assessOpportunity } from './assess'
import { buildMatchingProfile } from './profile'
import { prefilter, roleQueryFor, type RoleQuery } from './role-query'

// Each assessment is a model call. A run judges at most this many new offers;
// the rest wait for the next run, newest first.
const DEFAULT_LIMIT = 25
const CONCURRENCY = 3

export interface MatchingStats {
  profileHash: string
  open: number
  prefilterPassed: number
  prefilterOut: Record<string, number>
  alreadyAssessed: number
  assessedNow: number
  verdicts: Record<MatchVerdict, number>
  waiting: number
  errors: { opportunity: string; message: string }[]
}

// An assessment belongs to a profile and to a version of the assessor.
export function currentMatchKey(candidateId: string): string {
  return `${buildMatchingProfile(candidateId).hash}:${ASSESS_VERSION}`
}

export async function runMatching(options: { limit?: number } = {}): Promise<MatchingStats> {
  const candidate = getOrCreateCandidate()
  const profile = buildMatchingProfile(candidate.id)
  const query = await roleQueryFor(candidate.id, profile)
  const matchKey = `${profile.hash}:${ASSESS_VERSION}`
  const assessed = assessedOpportunityIds(matchKey)

  const stats: MatchingStats = {
    profileHash: matchKey,
    open: 0,
    prefilterPassed: 0,
    prefilterOut: {},
    alreadyAssessed: 0,
    assessedNow: 0,
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
  const batch = pending.slice(0, options.limit ?? DEFAULT_LIMIT)
  stats.waiting = pending.length - batch.length

  const queue = [...batch]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let opportunity = queue.shift(); opportunity; opportunity = queue.shift()) {
        try {
          const assessment = await assessOpportunity({ candidateId: candidate.id, opportunity, profile })
          insertMatch({
            candidateId: candidate.id,
            opportunityId: opportunity.id,
            profileHash: matchKey,
            verdict: assessment.verdict,
            gates: assessment.gates,
            explanation: assessment.explanation,
            dropped: assessment.dropped,
            modelRunId: assessment.modelRunId,
          })
          stats.assessedNow++
          stats.verdicts[assessment.verdict]++
        } catch (error) {
          stats.errors.push({
            opportunity: `${opportunity.company_name} · ${opportunity.title}`,
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

// EU and EEA, the UK and Switzerland.
const EUROPE = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
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

// One listening pass: read the sources, then judge what is new.
export async function runListening(options: { limit?: number } = {}): Promise<{ sourcing: SourcingStats; matching: MatchingStats }> {
  const candidate = getOrCreateCandidate()
  const query = await roleQueryFor(candidate.id, buildMatchingProfile(candidate.id))
  const sourcing = await runSourcing({ theirstack: theirStackQueryFrom(query) })
  const matching = await runMatching(options)
  return { sourcing, matching }
}
