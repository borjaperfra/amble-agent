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

  pending.sort((a, b) => (b.posted_at ?? b.first_seen_at).localeCompare(a.posted_at ?? a.first_seen_at))
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
  return {
    titleAny: query.titleInclude.slice(0, 20),
    titleNot: query.titleExclude.slice(0, 30),
    workplaces: query.requireRemote ? ['remote'] : undefined,
    maxAgeDays: 14,
    limit: 50,
  }
}

// One listening pass: read the sources, then judge what is new.
export async function runListening(options: { limit?: number } = {}): Promise<{ sourcing: SourcingStats; matching: MatchingStats }> {
  const candidate = getOrCreateCandidate()
  const query = await roleQueryFor(candidate.id, buildMatchingProfile(candidate.id))
  const sourcing = await runSourcing({ theirstack: theirStackQueryFrom(query) })
  const matching = await runMatching(options)
  return { sourcing, matching }
}
