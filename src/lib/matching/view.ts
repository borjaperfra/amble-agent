import { getOrCreateCandidate, listCapabilities, listConfirmedPreferences } from '../db/repo'
import { listMatchesForKey, type MatchListing, type MatchResponse, type MatchRow } from '../db/matching'
import { LANGUAGE_GATE, REMOTE_UNCONFIRMED_GATE, SALARY_FLOOR_GATE, type Explanation, type Gate, type RoleFit } from './assess'
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
  // As published; null when the offer does not say.
  salary: string | null
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
  | { kind: 'below_level'; text: string }
  | { kind: 'filter'; rule: string; quote: string | null }
  | { kind: 'salary_floor'; quote: string | null }
  | { kind: 'language'; quote: string | null }
  | { kind: 'remote_unconfirmed'; places: string | null }
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

function salaryText(match: MatchListing): string | null {
  if (match.salary_raw) return match.salary_raw
  if (!match.salary_min && !match.salary_max) return null
  const range = [match.salary_min, match.salary_max].filter(Boolean).map((n) => Math.round((n as number) / 1000) + 'K').join('–')
  return `${range} ${match.salary_currency ?? ''}`.trim()
}

// Postings of one role in several cities were judged together (one model run):
// the screen shows the role once, with every city. The link and the state are
// those of a posting still open, if any is.
function collapseRoles(matches: (MatchRow & MatchListing)[]): (MatchRow & MatchListing)[] {
  const roles = new Map<string, (MatchRow & MatchListing)[]>()
  for (const match of matches) {
    const key = match.model_run_id ? `${match.model_run_id}|${match.title}` : match.id
    roles.set(key, [...(roles.get(key) ?? []), match])
  }
  return [...roles.values()].map((postings) => {
    const lead = postings.find((posting) => !posting.closed_at) ?? postings[0]
    const open = postings.filter((posting) => !posting.closed_at)
    const places = [...new Set((open.length ? open : postings).map((posting) => posting.location).filter(Boolean))]
    return { ...lead, location: places.join(' · ') || null }
  })
}

export function getOpportunitiesView(): OpportunitiesView {
  const candidate = getOrCreateCandidate()
  const matches = collapseRoles(listMatchesForKey(candidate.id, currentMatchKey(candidate.id)))
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
        salary: salaryText(match),
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
    if (explanation.roleFit.fit === 'below_level') reasons.push({ kind: 'below_level', text: explanation.roleFit.reason })
    for (const gate of gates) {
      if (gate.ruleId === REMOTE_UNCONFIRMED_GATE) reasons.push({ kind: 'remote_unconfirmed', places: gate.quote })
      else if (gate.result !== 'fail') continue
      else if (gate.ruleId === SALARY_FLOOR_GATE) reasons.push({ kind: 'salary_floor', quote: gate.quote })
      else if (gate.ruleId === LANGUAGE_GATE) reasons.push({ kind: 'language', quote: gate.quote })
      else reasons.push({ kind: 'filter', rule: ruleLabels.get(gate.ruleId) ?? gate.ruleId, quote: gate.quote })
    }
    if (reasons.length === 0) reasons.push({ kind: 'no_reason' })
    discarded.push({ id: match.id, company: match.company_name, title: match.title, url: match.url, reasons, response })
  }

  // Unanswered first; within that, offers that publish a salary (the candidate
  // asked for them first); then newest, as the query already orders.
  const byAnswered = (a: FoundOpportunity, b: FoundOpportunity) =>
    Number(a.response !== null) - Number(b.response !== null) || Number(b.salary !== null) - Number(a.salary !== null)
  const fits = found.filter((item) => item.fit === 'fits').sort(byAnswered)
  const maybe = found.filter((item) => item.fit !== 'fits').sort(byAnswered)

  return {
    found: fits,
    maybe,
    discarded,
    unseen: fits.filter((item) => !item.closed && item.response === null).length,
  }
}
