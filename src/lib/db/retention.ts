import { getDb } from './db'
import { now } from './repo'

// How long offers are kept. An offer is worth storing while it is open, and
// after it closes only for as long as it explains something to the candidate.
//
//   open, seen recently      kept whole.
//   open, unseen 21 days     closed. No board or aggregator lists it any more
//                            (an aggregator never reports closure, a board
//                            that vanished never lists it again).
//   closed, no trace         deleted 14 days after closing, with its sightings
//                            and its assessments. The wait covers an offer
//                            taken down and put back up.
//   closed, with a trace     kept: the Rep showed it or set it aside, or the
//                            candidate answered it. That history is what the
//                            learning loop reads. Its description, nearly all
//                            of its size, is dropped 30 days after closing;
//                            title, company, link, salary and the assessment
//                            stay.
//
// Rows deleted do not shrink the file on their own; the file is compacted when
// a fifth of it is free.

const DAY_MS = 24 * 60 * 60 * 1000
export const STALE_AFTER_DAYS = 21
export const DELETE_CLOSED_AFTER_DAYS = 14
export const STRIP_DESCRIPTION_AFTER_DAYS = 30
const VACUUM_FREE_SHARE = 0.2

export interface RetentionStats {
  closedStale: number
  deleted: number
  stripped: number
  vacuumed: boolean
}

function daysAgo(days: number, from: string): string {
  return new Date(Date.parse(from) - days * DAY_MS).toISOString()
}

// An offer the candidate has a reason to see again.
const HAS_TRACE = `EXISTS (
  SELECT 1 FROM opportunity_matches m
  WHERE m.opportunity_id = o.id AND (m.verdict IN ('show', 'hold') OR m.response IS NOT NULL)
)`

export function applyRetention(at: string = now()): RetentionStats {
  const db = getDb()
  const stats: RetentionStats = { closedStale: 0, deleted: 0, stripped: 0, vacuumed: false }

  db.exec('BEGIN')
  try {
    const staleBefore = daysAgo(STALE_AFTER_DAYS, at)
    db.prepare('UPDATE opportunity_sources SET closed_at = ? WHERE closed_at IS NULL AND last_seen_at < ?').run(at, staleBefore)
    stats.closedStale = Number(
      db.prepare('UPDATE opportunities SET closed_at = ? WHERE closed_at IS NULL AND last_seen_at < ?').run(at, staleBefore).changes,
    )

    const deleteBefore = daysAgo(DELETE_CLOSED_AFTER_DAYS, at)
    const doomed = `SELECT o.id FROM opportunities o WHERE o.closed_at IS NOT NULL AND o.closed_at < ? AND NOT ${HAS_TRACE}`
    db.prepare(`DELETE FROM opportunity_matches WHERE opportunity_id IN (${doomed})`).run(deleteBefore)
    db.prepare(`DELETE FROM opportunity_sources WHERE opportunity_id IN (${doomed})`).run(deleteBefore)
    stats.deleted = Number(db.prepare(`DELETE FROM opportunities WHERE id IN (${doomed})`).run(deleteBefore).changes)

    stats.stripped = Number(
      db
        .prepare('UPDATE opportunities SET description = NULL WHERE closed_at IS NOT NULL AND closed_at < ? AND description IS NOT NULL')
        .run(daysAgo(STRIP_DESCRIPTION_AFTER_DAYS, at)).changes,
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const pages = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count
  const free = (db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count
  if (pages > 0 && free / pages >= VACUUM_FREE_SHARE) {
    // In WAL mode the compacted file only replaces the old one at a checkpoint.
    db.exec('VACUUM')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    stats.vacuumed = true
  }
  return stats
}
