import { getDb, inTransaction, prepared } from '../db/db'
import { listDecisions, listMatchesForKey } from '../db/matching'
import { now } from '../db/repo'
import type { Explanation } from './assess'
import { currentMatchKey } from './run'

// How offers reach a person: a few at a time, never all the reader found.
// Thirty offers on the first visit read as a list to sift, not as a Rep that
// chose. The first time, the best FIRST_RELEASE; then at most PER_DAY more
// every 24 hours. What is released is the same on the screens and on
// WhatsApp, which sends only from it.
//
// Best first: their role before an adjacent one, then what was published in
// the last FRESH_DAYS, then what publishes a salary, then the newest. An
// offer they answered, or one amble already sent them, stays theirs to see
// whether it was released or not.

export const FIRST_RELEASE = 10
export const PER_DAY = 3
const FRESH_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

interface Waiting {
  opportunityId: string
  fits: boolean
  fresh: boolean
  salary: boolean
  publishedAt: string
}

export function releasedIds(candidateId: string): Set<string> {
  const rows = getDb().prepare('SELECT opportunity_id FROM offer_releases WHERE candidate_id = ?').all(candidateId) as unknown as { opportunity_id: string }[]
  return new Set(rows.map((row) => row.opportunity_id))
}

// Releases what is due now and returns everything released so far.
export function releaseDue(candidateId: string): Set<string> {
  const db = getDb()
  const released = releasedIds(candidateId)
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString()
  const { first, lastDay } = db
    .prepare('SELECT MIN(released_at) AS first, SUM(released_at >= ?) AS lastDay FROM offer_releases WHERE candidate_id = ?')
    .get(dayAgo, candidateId) as { first: string | null; lastDay: number | null }
  // Their first day fills up to the first release as the first read finds
  // offers; every day after, a few more.
  const room = !first || first >= dayAgo ? FIRST_RELEASE - released.size : PER_DAY - (lastDay ?? 0)
  if (room <= 0) return released

  const decisions = listDecisions(candidateId)
  const sent = new Set(
    (db.prepare("SELECT opportunity_id FROM offer_sends WHERE candidate_id = ? AND sent_at IS NOT NULL").all(candidateId) as unknown as { opportunity_id: string }[]).map(
      (row) => row.opportunity_id,
    ),
  )
  const published = db.prepare('SELECT COALESCE(posted_at, first_seen_at) AS at FROM opportunities WHERE id = ?')
  const freshSince = new Date(Date.now() - FRESH_DAYS * DAY_MS).toISOString()
  const seenRoles = new Set<string>()
  const waiting: Waiting[] = []
  for (const match of listMatchesForKey(candidateId, currentMatchKey(candidateId))) {
    // One role posted in several cities is one offer.
    const role = match.model_run_id ?? match.id
    if (seenRoles.has(role)) continue
    seenRoles.add(role)
    if (match.verdict !== 'show' || match.closed_at || match.response) continue
    if (released.has(match.opportunity_id) || decisions.has(match.opportunity_id) || sent.has(match.opportunity_id)) continue
    const explanation = JSON.parse(match.explanation) as Explanation
    const at = (published.get(match.opportunity_id) as { at: string } | undefined)?.at ?? match.created_at
    waiting.push({
      opportunityId: match.opportunity_id,
      fits: explanation.roleFit.fit === 'fits',
      fresh: at >= freshSince,
      salary: Boolean(match.salary_raw || match.salary_min || match.salary_max),
      publishedAt: at,
    })
  }
  waiting.sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) || Number(b.fresh) - Number(a.fresh) || Number(b.salary) - Number(a.salary) || b.publishedAt.localeCompare(a.publishedAt),
  )

  const chosen = waiting.slice(0, room)
  if (chosen.length > 0) {
    const insert = prepared('INSERT OR IGNORE INTO offer_releases (candidate_id, opportunity_id, released_at) VALUES (?, ?, ?)')
    const at = now()
    inTransaction(() => {
      for (const item of chosen) insert.run(candidateId, item.opportunityId, at)
    })
    for (const item of chosen) released.add(item.opportunityId)
  }
  return released
}
