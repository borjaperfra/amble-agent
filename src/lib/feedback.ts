import { getDb } from './db/db'
import { newId, now, type CandidateRow } from './db/repo'

// What beta users tell us, from the app now and from WhatsApp later: kept with
// who said it, where they were and how it reached us, and sent to the owner
// the moment it arrives.

export type FeedbackChannel = 'app' | 'whatsapp'

export interface FeedbackRow {
  id: string
  candidate_id: string
  channel: FeedbackChannel
  page: string | null
  message: string
  created_at: string
  seen_at: string | null
}

export interface FeedbackListing extends FeedbackRow {
  email: string | null
  name: string | null
}

const MAX_MESSAGE = 4000

export function recordFeedback(candidate: CandidateRow, params: { message: string; page: string | null; channel: FeedbackChannel }): FeedbackRow {
  const row: FeedbackRow = {
    id: newId('fb'),
    candidate_id: candidate.id,
    channel: params.channel,
    page: params.page ? params.page.slice(0, 200) : null,
    message: params.message.trim().slice(0, MAX_MESSAGE),
    created_at: now(),
    seen_at: null,
  }
  getDb()
    .prepare('INSERT INTO feedback (id, candidate_id, channel, page, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.candidate_id, row.channel, row.page, row.message, row.created_at)
  return row
}

export function listFeedback(): FeedbackListing[] {
  return getDb()
    .prepare(
      `SELECT f.*, c.email, c.name FROM feedback f JOIN candidates c ON c.id = f.candidate_id
       ORDER BY f.seen_at IS NOT NULL, f.created_at DESC`,
    )
    .all() as unknown as FeedbackListing[]
}

export function markFeedbackSeen(id: string, seen: boolean): void {
  getDb().prepare('UPDATE feedback SET seen_at = ? WHERE id = ?').run(seen ? now() : null, id)
}

export function ownerEmail(): string | null {
  const row = getDb().prepare("SELECT email FROM candidates WHERE role = 'owner' AND email IS NOT NULL LIMIT 1").get() as
    | { email: string }
    | undefined
  return row?.email ?? null
}
