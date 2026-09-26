import { getOrCreateCandidate, listCapabilities, listConfirmedPreferences } from '../db/repo'
import { listMatchesForKey, type MatchResponse } from '../db/matching'
import type { Explanation, Gate, RoleFit } from './assess'
import { currentMatchKey } from './run'

// What the opportunities screen shows. Only assessments made against the
// current profile and assessor version: after a preference changes, older
// verdicts are stale and are not shown as if they still held.

export interface FoundOpportunity {
  id: string
  company: string
  title: string
  location: string | null
  workplace: string | null
  url: string | null
  closed: boolean
  fit: RoleFit
  summary: string
  why: { text: string; evidence: string | null; quote: string | null }[]
  considerAlso: { text: string; quote: string | null } | null
  unknowns: string[]
  response: MatchResponse | null
}

export type DiscardReason =
  | { kind: 'wrong_role'; text: string }
  | { kind: 'filter'; rule: string; quote: string | null }
  | { kind: 'no_reason' }

export interface DiscardedOpportunity {
  id: string
  company: string
  title: string
  url: string | null
  reasons: DiscardReason[]
  response: MatchResponse | null
}

export interface OpportunitiesView {
  // Roles that fit: the only ones that interrupt the candidate.
  found: FoundOpportunity[]
  // Adjacent roles (stretch): worth a look, never an interruption. Showing them
  // alongside the real ones would spend the trust the interruption relies on.
  maybe: FoundOpportunity[]
  discarded: DiscardedOpportunity[]
  // Shown, open and not yet answered: what makes Listening say "I found something".
  unseen: number
}

export function getOpportunitiesView(): OpportunitiesView {
  const candidate = getOrCreateCandidate()
  const matches = listMatchesForKey(candidate.id, currentMatchKey(candidate.id))
  const capabilityNames = new Map(listCapabilities(candidate.id).map((capability) => [capability.id, capability.name]))
  const ruleLabels = new Map(listConfirmedPreferences(candidate.id).map((row) => [row.id, row.label ?? row.statement]))

  const found: FoundOpportunity[] = []
  const discarded: DiscardedOpportunity[] = []

  for (const match of matches) {
    const explanation = JSON.parse(match.explanation) as Explanation
    const response = match.response as MatchResponse | null

    if (match.verdict === 'show') {
      found.push({
        id: match.id,
        company: match.company_name,
        title: match.title,
        location: match.location,
        workplace: match.workplace,
        url: match.url,
        closed: match.closed_at !== null,
        fit: explanation.roleFit.fit,
        summary: explanation.summary,
        why: explanation.why.map((reason) => ({
          text: reason.text,
          evidence: reason.capabilityId ? (capabilityNames.get(reason.capabilityId) ?? null) : null,
          quote: reason.quote,
        })),
        considerAlso: explanation.considerAlso,
        unknowns: explanation.unknowns,
        response,
      })
      continue
    }

    // A closed offer the Rep set aside is no longer worth revisiting.
    if (match.closed_at) continue
    const gates = JSON.parse(match.gates) as Gate[]
    const reasons: DiscardReason[] = []
    if (explanation.roleFit.fit === 'wrong_role') reasons.push({ kind: 'wrong_role', text: explanation.roleFit.reason })
    for (const gate of gates.filter((g) => g.result === 'fail')) {
      reasons.push({ kind: 'filter', rule: ruleLabels.get(gate.ruleId) ?? gate.ruleId, quote: gate.quote })
    }
    if (reasons.length === 0) reasons.push({ kind: 'no_reason' })
    discarded.push({ id: match.id, company: match.company_name, title: match.title, url: match.url, reasons, response })
  }

  // Unanswered first, then newest (the query already orders by recency).
  const byAnswered = (a: FoundOpportunity, b: FoundOpportunity) => Number(a.response !== null) - Number(b.response !== null)
  const fits = found.filter((item) => item.fit === 'fits').sort(byAnswered)
  const maybe = found.filter((item) => item.fit !== 'fits').sort(byAnswered)

  return {
    found: fits,
    maybe,
    discarded,
    unseen: fits.filter((item) => !item.closed && item.response === null).length,
  }
}
