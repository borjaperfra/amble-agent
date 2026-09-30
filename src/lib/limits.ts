import { getDb, inTransaction } from './db/db'
import { now } from './db/repo'

// How much one person can give amble to read. A CV, a site, a GitHub profile
// and a few documents are plenty to know someone; past that, what comes is
// more likely a script than a person, and each file costs reading and a
// model call. Every attempt counts toward the day, accepted or not: a file
// refused is still one that was read.

const MAX_SOURCES = 10
const MAX_ADDS_PER_DAY = 20
const MAX_CVS_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000

export type IntakeKind = 'source' | 'application_cv'

export type IntakeRefusal = 'too_many_sources' | 'too_many_today'

function countToday(candidateId: string, kind: IntakeKind): number {
  const since = new Date(Date.now() - DAY_MS).toISOString()
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM intake_events WHERE candidate_id = ? AND kind = ? AND created_at > ?')
    .get(candidateId, kind, since) as { count: number }
  return row.count
}

// Checks and, when allowed, counts the attempt in one step, so two requests
// at once cannot both slip under the limit.
export function takeIntake(candidateId: string, kind: IntakeKind): IntakeRefusal | null {
  return inTransaction(() => {
    const db = getDb()
    if (kind === 'source') {
      const kept = db
        .prepare("SELECT COUNT(*) AS count FROM sources WHERE candidate_id = ? AND status NOT IN ('rejected', 'failed')")
        .get(candidateId) as { count: number }
      if (kept.count >= MAX_SOURCES) return 'too_many_sources'
    }
    if (countToday(candidateId, kind) >= (kind === 'source' ? MAX_ADDS_PER_DAY : MAX_CVS_PER_DAY)) return 'too_many_today'
    db.prepare('INSERT INTO intake_events (candidate_id, kind, created_at) VALUES (?, ?, ?)').run(candidateId, kind, now())
    // Older than a day, an attempt no longer counts for anything.
    db.prepare('DELETE FROM intake_events WHERE candidate_id = ? AND created_at <= ?').run(candidateId, new Date(Date.now() - DAY_MS).toISOString())
    return null
  })
}
