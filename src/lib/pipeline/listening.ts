import {
  getCurrentIntent,
  getLatestIntent,
  getLatestOfferTriage,
  listConfirmedPreferences,
  listProposedPreferences,
  listRevealedPreferences,
  parseJsonArray,
  type RevealedPreferenceRow,
} from '../db/repo'
import { syncSaidRules } from './said-rules'

// What the Rep listens for (PRODUCT_SPEC §15, §15.1, §16). This is the single
// place that decides it; anything that filters opportunities reads it here.
//
// Two sources, kept apart because they mean different things:
//   declared  what the candidate said, structured and confirmed (§15)
//   revealed  what their answers showed, confirmed by them one by one (§15.1)

// A rule holds until they change it or take it away: none lapses with time.
// Until 2026-11-08 a rule stopped applying 90 days after it was confirmed,
// unless they said it still held; nobody was told on the chat, so a rule
// confirmed in October would have quietly stopped in January.

export interface ListeningItem {
  id: string
  label: string
  // The full sentence: what a matcher checks an offer against.
  statement: string
  // The rule as the person reads it, and why amble believes it. The matcher
  // never reads these: the statement is its input.
  wording: string
  evidence: string | null
  // Where it came from: said | triage | chat | own; null on a rule written before that was kept.
  source: string | null
}

export interface ListeningProfile {
  declared: {
    items: string[]
    confirmed: boolean
    stale: boolean
  }
  revealed: {
    rules: { wontConsider: ListeningItem[]; weighs: ListeningItem[]; money: ListeningItem[] }
    // Refuted or irrelevant conditions: the Rep must not filter on them even if
    // they appear among the declared items.
    notFilteringOn: ListeningItem[]
    staleCount: number
  }
  pendingReview: number
}

// A label is a listening item; without one, the statement's first clause is
// the most faithful short form available.
export function shortLabel(row: RevealedPreferenceRow): string {
  if (row.label) return row.label
  const clause = (row.wording ?? row.statement).split(/[:;.—]/)[0].trim()
  return clause.length > 70 ? `${clause.slice(0, 67).trimEnd()}…` : clause
}

export function getListeningProfile(candidateId: string): ListeningProfile {
  // What they said and confirmed is among the rules below (said-rules.ts).
  syncSaidRules(candidateId)
  // What they confirmed; before any, what they wrote (shown as not confirmed).
  const intent = getCurrentIntent(candidateId) ?? getLatestIntent(candidateId)

  const wontConsider: ListeningItem[] = []
  const weighs: ListeningItem[] = []
  const money: ListeningItem[] = []
  const notFilteringOn: ListeningItem[] = []
  // No rule lapses (above): none is ever set aside as stale.
  const staleCount = 0

  for (const row of listConfirmedPreferences(candidateId)) {
    // A self-filter never becomes a listening rule, confirmed or not: an agent
    // that inherits it discards offers the candidate would win, invisibly.
    if (row.kind === 'self_filter') continue
    const item = { id: row.id, label: shortLabel(row), statement: row.statement, wording: row.wording ?? row.statement, evidence: row.evidence, source: row.source }
    if (row.kind === 'hard_filter') wontConsider.push(item)
    else if (row.kind === 'strong') weighs.push(item)
    else if (row.kind === 'compensation') money.push(item)
    else if (row.kind === 'weak' || row.kind === 'neutral') notFilteringOn.push(item)
  }

  const latestTriage = getLatestOfferTriage(candidateId)
  // What waits for their yes: their triage's proposals and those from offers they turned down.
  const fromTriage =
    latestTriage && latestTriage.status === 'analysed' ? listRevealedPreferences(latestTriage.id).filter((row) => row.status === 'proposed').length : 0
  const pendingReview = fromTriage + listProposedPreferences(candidateId).length

  return {
    declared: {
      items: intent ? parseJsonArray(intent.listening_for) : [],
      confirmed: Boolean(intent?.confirmed_at),
      // What they said they look for holds until they change it, as rules do.
      stale: false,
    },
    revealed: { rules: { wontConsider, weighs, money }, notFilteringOn, staleCount },
    pendingReview,
  }
}
