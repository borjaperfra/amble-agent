import { officeNotAllowed } from './office'
import { excludedCompanyIds } from '../db/excluded-companies'
import { workplaceShown } from './workplace'
import { getDb, inTransaction, prepared } from '../db/db'
import { listDecisions, listMatchesForKey } from '../db/matching'
import { now } from '../db/repo'
import type { Explanation } from './assess'
import { buildMatchingProfile } from './profile'
import { storedRoleQuery } from './role-query'
import { currentMatchKey, placeFit } from './run'
import { estimatedShort, estimatesFor } from '../salary/estimate'

// How offers reach a person: a few at a time, never all the reader found.
// Thirty offers on the first visit read as a list to sift, not as a Rep that
// chose. The first time, the best FIRST_RELEASE; then at most PER_DAY more
// every 24 hours. What is released is the same on the screens and on
// WhatsApp, which sends only from it.
//
// Best first: their role before an adjacent one, then where it is (their city
// or country, then open to them, then elsewhere in Europe, then outside it),
// then what was published in the last FRESH_DAYS, then what publishes a
// salary, then the newest. An
// offer they answered, or one amble already sent them, stays theirs to see
// whether it was released or not.

export const FIRST_RELEASE = 10
export const PER_DAY = 3
const FRESH_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

// The first read starts while the setup's questions are answered (setup.ts),
// and their answers change the profile: for that first while, what it judged
// before them can be given too, or the first offers would wait for the re-read.
const SETUP_READ_MS = 15 * 60 * 1000

function setupReadMatches(candidateId: string): ReturnType<typeof listMatchesForKey> {
  const db = getDb()
  const first = (db.prepare('SELECT MIN(created_at) AS at FROM opportunity_matches WHERE candidate_id = ?').get(candidateId) as { at: string | null }).at
  if (!first || Date.now() - Date.parse(first) >= SETUP_READ_MS) return []
  const current = currentMatchKey(candidateId)
  const keys = db.prepare('SELECT DISTINCT profile_hash FROM opportunity_matches WHERE candidate_id = ? AND profile_hash != ?').all(candidateId, current) as unknown as {
    profile_hash: string
  }[]
  return keys.flatMap((row) => listMatchesForKey(candidateId, row.profile_hash))
}

export interface Waiting {
  opportunityId: string
  fits: boolean
  near: number
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

  const chosen = waitingToRelease(candidateId, released).slice(0, room)
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

// What is still to be released to them, in the order it would be: the
// next ones first.
export function waitingToRelease(candidateId: string, released: Set<string> = releasedIds(candidateId)): Waiting[] {
  const db = getDb()
  const query = storedRoleQuery(candidateId, buildMatchingProfile(candidateId))
  const decisions = listDecisions(candidateId)
  const sent = new Set(
    (db.prepare("SELECT opportunity_id FROM offer_sends WHERE candidate_id = ? AND sent_at IS NOT NULL").all(candidateId) as unknown as { opportunity_id: string }[]).map(
      (row) => row.opportunity_id,
    ),
  )
  const published = db.prepare('SELECT COALESCE(posted_at, first_seen_at) AS at FROM opportunities WHERE id = ?')
  const freshSince = new Date(Date.now() - FRESH_DAYS * DAY_MS).toISOString()
  const seenRoles = new Set<string>()
  // A company they want nothing from: never released (#44).
  const excluded = excludedCompanyIds(candidateId)
  const waiting: Waiting[] = []
  const listed = new Set<string>()
  for (const match of [...listMatchesForKey(candidateId, currentMatchKey(candidateId)), ...setupReadMatches(candidateId)]) {
    // Judged under the current profile and the one before it: the current
    // judgment decides, whatever it was.
    if (listed.has(match.opportunity_id)) continue
    listed.add(match.opportunity_id)
    // One role posted in several cities is one offer.
    const role = match.model_run_id ?? match.id
    if (seenRoles.has(role)) continue
    seenRoles.add(role)
    if (match.verdict !== 'show' || match.closed_at || match.response) continue
    if (released.has(match.opportunity_id) || decisions.has(match.opportunity_id) || sent.has(match.opportunity_id)) continue
    if (excluded.has(match.company_id)) continue
    // An office where they would not go: never released (office.ts).
    if (officeNotAllowed(match.location, workplaceShown(match.opportunity_id, match.workplace), query)) continue
    const explanation = JSON.parse(match.explanation) as Explanation
    const at = (published.get(match.opportunity_id) as { at: string } | undefined)?.at ?? match.created_at
    waiting.push({
      opportunityId: match.opportunity_id,
      fits: explanation.roleFit.fit === 'fits',
      near: query ? placeFit(match.location, query) : 1,
      fresh: at >= freshSince,
      salary: Boolean(match.salary_raw || match.salary_min || match.salary_max),
      publishedAt: at,
    })
  }
  // Estimated below their floor, publishing none: set aside, not released (#20).
  const estimates = estimatesFor(waiting.filter((item) => !item.salary).map((item) => item.opportunityId))
  const floor = query?.salaryFloor ?? null
  const due = waiting.filter((item) => item.salary || !estimatedShort(estimates.get(item.opportunityId), floor))
  return due.sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) || a.near - b.near || Number(b.fresh) - Number(a.fresh) || Number(b.salary) - Number(a.salary) || b.publishedAt.localeCompare(a.publishedAt),
  )
}
