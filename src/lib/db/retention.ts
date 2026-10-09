import fs from 'node:fs'
import path from 'node:path'
import { volumeUsage } from './backup'
import { DATA_DIRECTORY, getDb, inTransaction } from './db'
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
// WhatsApp events already handled are kept 30 days, far longer than the
// provider retries a delivery: one delivered again is still recognised and
// never handled twice.
//
// The record of each model call (which task, prompt version, model, when,
// how long, whether it worked) is kept a year: it is how a judgment amble
// made can be explained and checked later, as the EU AI Act asks of those
// who use AI systems to keep logs. What the model answered word for word
// carries personal data and is not needed for that: it goes after six
// months (the Act's minimum for logs), leaving the rest of the record.
// What it answered about an offer (its judgment, its facts) goes after two
// weeks: that answer is already kept where it is used (the assessment, the
// facts), and at thousands of calls a day it was a fifth of the database.
// A call that failed keeps its answer the six months: it is what explains it.
//
// Rows deleted do not shrink the file on their own; the file is compacted when
// a fifth of it is free, and once a week anyway: rows deleted here and there
// leave pages half empty that are not counted free (on a replica, 471 MB
// became 319 with 13 % of it free). Compacting writes the whole database once
// more on the volume, so it waits for room.

const DAY_MS = 24 * 60 * 60 * 1000
export const STALE_AFTER_DAYS = 21
export const DELETE_CLOSED_AFTER_DAYS = 14
export const STRIP_DESCRIPTION_AFTER_DAYS = 30
export const FORGET_WHATSAPP_EVENTS_AFTER_DAYS = 30
export const STRIP_MODEL_OUTPUT_AFTER_DAYS = 183
export const STRIP_ROUTINE_OUTPUT_AFTER_DAYS = 14
const ROUTINE_TASKS = ['assess_opportunity', 'read_offer_facts']
export const FORGET_MODEL_RUNS_AFTER_DAYS = 365
const VACUUM_FREE_SHARE = 0.2
const VACUUM_EVERY_DAYS = 7
const LAST_VACUUM_FILE = path.join(DATA_DIRECTORY, 'last-vacuum')

export interface RetentionStats {
  closedStale: number
  deleted: number
  stripped: number
  whatsappEvents: number
  modelOutputsStripped: number
  modelRunsDeleted: number
  vacuumed: boolean
}

function daysAgo(days: number, from: string): string {
  return new Date(Date.parse(from) - days * DAY_MS).toISOString()
}

// An offer the candidate has a reason to see again. What they decided about
// it (and what the Rep prepared for it) belongs to the offer and outlives its
// assessments; those rows also point at the offer, so it could not go anyway.
const HAS_TRACE = `(
  EXISTS (
    SELECT 1 FROM opportunity_matches m
    WHERE m.opportunity_id = o.id AND (m.verdict IN ('show', 'hold') OR m.response IS NOT NULL)
  )
  OR EXISTS (SELECT 1 FROM opportunity_decisions d WHERE d.opportunity_id = o.id)
  OR EXISTS (SELECT 1 FROM application_drafts a WHERE a.opportunity_id = o.id)
)`

export function applyRetention(at: string = now()): RetentionStats {
  const db = getDb()
  const stats: RetentionStats = { closedStale: 0, deleted: 0, stripped: 0, whatsappEvents: 0, modelOutputsStripped: 0, modelRunsDeleted: 0, vacuumed: false }

  inTransaction(() => {
    const staleBefore = daysAgo(STALE_AFTER_DAYS, at)
    db.prepare('UPDATE opportunity_sources SET closed_at = ? WHERE closed_at IS NULL AND last_seen_at < ?').run(at, staleBefore)
    stats.closedStale = Number(
      db.prepare('UPDATE opportunities SET closed_at = ? WHERE closed_at IS NULL AND last_seen_at < ?').run(at, staleBefore).changes,
    )

    const deleteBefore = daysAgo(DELETE_CLOSED_AFTER_DAYS, at)
    const doomed = `SELECT o.id FROM opportunities o WHERE o.closed_at IS NOT NULL AND o.closed_at < ? AND NOT ${HAS_TRACE}`
    db.prepare(`DELETE FROM opportunity_matches WHERE opportunity_id IN (${doomed})`).run(deleteBefore)
    db.prepare(`DELETE FROM opportunity_sources WHERE opportunity_id IN (${doomed})`).run(deleteBefore)
    db.prepare(`DELETE FROM opportunity_facts WHERE opportunity_id IN (${doomed})`).run(deleteBefore)
    stats.deleted = Number(db.prepare(`DELETE FROM opportunities WHERE id IN (${doomed})`).run(deleteBefore).changes)

    stats.stripped = Number(
      db
        .prepare('UPDATE opportunities SET description = NULL WHERE closed_at IS NOT NULL AND closed_at < ? AND description IS NOT NULL')
        .run(daysAgo(STRIP_DESCRIPTION_AFTER_DAYS, at)).changes,
    )

    stats.whatsappEvents = Number(
      db.prepare('DELETE FROM whatsapp_events WHERE received_at < ?').run(daysAgo(FORGET_WHATSAPP_EVENTS_AFTER_DAYS, at)).changes,
    )

    stats.modelOutputsStripped = Number(
      db
        .prepare('UPDATE model_runs SET raw_output = NULL WHERE created_at < ? AND raw_output IS NOT NULL')
        .run(daysAgo(STRIP_MODEL_OUTPUT_AFTER_DAYS, at)).changes,
    )
    stats.modelOutputsStripped += Number(
      db
        .prepare(
          `UPDATE model_runs SET raw_output = NULL WHERE created_at < ? AND ok = 1 AND raw_output IS NOT NULL AND task IN (${ROUTINE_TASKS.map(() => '?').join(', ')})`,
        )
        .run(daysAgo(STRIP_ROUTINE_OUTPUT_AFTER_DAYS, at), ...ROUTINE_TASKS).changes,
    )
    stats.modelRunsDeleted = Number(db.prepare('DELETE FROM model_runs WHERE created_at < ?').run(daysAgo(FORGET_MODEL_RUNS_AFTER_DAYS, at)).changes)
  })

  // The planner's picture of each table, redone for those that changed a lot.
  db.exec('PRAGMA optimize')

  const pages = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count
  const free = (db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count
  let last = 0
  try {
    last = Date.parse(fs.readFileSync(LAST_VACUUM_FILE, 'utf8').trim()) || 0
  } catch {
    // Never compacted here: it is due.
  }
  const due = (pages > 0 && free / pages >= VACUUM_FREE_SHARE) || Date.parse(at) - last >= VACUUM_EVERY_DAYS * DAY_MS
  const usage = volumeUsage()
  const room = !usage || usage.available > usage.database * 1.2
  if (due && room) {
    // In WAL mode the compacted file only replaces the old one at a checkpoint.
    db.exec('VACUUM')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    fs.writeFileSync(LAST_VACUUM_FILE, at)
    stats.vacuumed = true
  }
  return stats
}
