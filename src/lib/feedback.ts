import { sendEmail } from './auth/email'
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

export const MAX_FEEDBACK_MESSAGE = 4000
// Emails to the owner about one person's feedback in a day: everything is
// kept (and listed), but a flood does not become a flood of email.
const EMAILS_PER_DAY = 10
const DAY_MS = 24 * 60 * 60 * 1000

export function recordFeedback(candidate: CandidateRow, params: { message: string; page: string | null; channel: FeedbackChannel }): FeedbackRow {
  const row: FeedbackRow = {
    id: newId('fb'),
    candidate_id: candidate.id,
    channel: params.channel,
    page: params.page ? params.page.slice(0, 200) : null,
    message: params.message.trim().slice(0, MAX_FEEDBACK_MESSAGE),
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

// What one person sent through a channel in the last day.
export function feedbackToday(candidateId: string, channel: FeedbackChannel): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM feedback WHERE candidate_id = ? AND channel = ? AND created_at >= ?')
      .get(candidateId, channel, new Date(Date.now() - DAY_MS).toISOString()) as { n: number }
  ).n
}

// The owner hears about it at once; a failed email never loses the feedback.
export async function emailOwnerAbout(candidate: CandidateRow, row: FeedbackRow): Promise<void> {
  const to = ownerEmail()
  // This one included: past the day's emails, it waits in the list.
  if (!to || feedbackToday(candidate.id, row.channel) > EMAILS_PER_DAY) return
  await sendEmail({
    to,
    subject: `Feedback de ${candidate.name ?? candidate.email ?? candidate.id}`,
    text: `${row.message}

— ${candidate.name ?? ''} <${candidate.email ?? 'sin email'}>
Pantalla: ${row.page ?? '—'}
Vía: ${row.channel}

Todo el feedback: ${(process.env.AMBLE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/feedback`,
    idempotencyKey: row.id,
  }).catch((error) => console.error('[amble] feedback email not sent:', error instanceof Error ? error.message : error))
}

export function ownerEmail(): string | null {
  const row = getDb().prepare("SELECT email FROM candidates WHERE role = 'owner' AND email IS NOT NULL LIMIT 1").get() as
    | { email: string }
    | undefined
  return row?.email ?? null
}
