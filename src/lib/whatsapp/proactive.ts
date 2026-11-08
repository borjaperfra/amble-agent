import { getDb } from '../db/db'

// amble writes first at most once a day, whatever it has: an offer, a
// question about their profile, a follow-up on an application. The rest
// waits for another day, so WhatsApp never becomes one more thing that
// overwhelms them. A reminder they asked for still goes on its day, and
// counts; answers to what they write are never held back.

const QUIET_HOURS = 20

export function wroteFirstRecently(candidateId: string, hours = QUIET_HOURS): boolean {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM offer_sends WHERE candidate_id = ? AND sent_at >= ?
         UNION ALL SELECT 1 FROM application_followups WHERE candidate_id = ? AND asked_at >= ?
         UNION ALL SELECT 1 FROM whatsapp_questions WHERE candidate_id = ? AND asked_at >= ?
         UNION ALL SELECT 1 FROM whatsapp_reminders WHERE candidate_id = ? AND sent_at >= ?
         UNION ALL SELECT 1 FROM candidates WHERE id = ? AND quiet_note_at >= ?
         LIMIT 1`,
      )
      .get(candidateId, since, candidateId, since, candidateId, since, candidateId, since, candidateId, since),
  )
}
