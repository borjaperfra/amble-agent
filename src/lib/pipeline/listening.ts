import {
  getLatestIntent,
  getLatestOfferTriage,
  listConfirmedPreferences,
  listRevealedPreferences,
  parseJsonArray,
  type RevealedPreferenceRow,
} from '../db/repo'

// What the Rep listens for (PRODUCT_SPEC §15, §15.1, §16). This is the single
// place that decides it; anything that filters opportunities reads it here.
//
// Two sources, kept apart because they mean different things:
//   declared  what the candidate said, structured and confirmed (§15)
//   revealed  what their answers showed, confirmed by them one by one (§15.1)

// Same horizon as a confirmed intent: preferences go stale, and stale ones must
// not be applied as if they were current.
const REVEALED_VALID_DAYS = 90

export interface ListeningItem {
  id: string
  label: string
  // The full sentence: what a matcher checks an offer against.
  statement: string
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
function shortLabel(row: RevealedPreferenceRow): string {
  if (row.label) return row.label
  const clause = row.statement.split(/[:;.—]/)[0].trim()
  return clause.length > 70 ? `${clause.slice(0, 67).trimEnd()}…` : clause
}

function isStale(row: RevealedPreferenceRow, now: number): boolean {
  if (!row.decided_at) return true
  return now - Date.parse(row.decided_at) > REVEALED_VALID_DAYS * 24 * 60 * 60 * 1000
}

export function getListeningProfile(candidateId: string): ListeningProfile {
  const now = Date.now()
  const intent = getLatestIntent(candidateId)

  const wontConsider: ListeningItem[] = []
  const weighs: ListeningItem[] = []
  const money: ListeningItem[] = []
  const notFilteringOn: ListeningItem[] = []
  let staleCount = 0

  for (const row of listConfirmedPreferences(candidateId)) {
    // A self-filter never becomes a listening rule, confirmed or not: an agent
    // that inherits it discards offers the candidate would win, invisibly.
    if (row.kind === 'self_filter') continue
    if (isStale(row, now)) {
      staleCount++
      continue
    }
    const item = { id: row.id, label: shortLabel(row), statement: row.statement }
    if (row.kind === 'hard_filter') wontConsider.push(item)
    else if (row.kind === 'strong') weighs.push(item)
    else if (row.kind === 'compensation') money.push(item)
    else if (row.kind === 'weak' || row.kind === 'neutral') notFilteringOn.push(item)
  }

  const latestTriage = getLatestOfferTriage(candidateId)
  const pendingReview =
    latestTriage && latestTriage.status === 'analysed'
      ? listRevealedPreferences(latestTriage.id).filter((row) => row.status === 'proposed').length
      : 0

  return {
    declared: {
      items: intent ? parseJsonArray(intent.listening_for) : [],
      confirmed: Boolean(intent?.confirmed_at),
      stale: Boolean(intent?.valid_until && Date.parse(intent.valid_until) < now),
    },
    revealed: { rules: { wontConsider, weighs, money }, notFilteringOn, staleCount },
    pendingReview,
  }
}
