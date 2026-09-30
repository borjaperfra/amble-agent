import { getDb } from '../db/db'
import { isSearchPaused, newId, now } from '../db/repo'
import { logMessage } from './conversation'
import { linkOf, windowOpen } from './link'
import { sendMessage, zernioConfig } from './zernio'

// What the agent left itself to say on a later day: how an interview went,
// the day after it; a deadline, the day before. Sent with the daily round,
// mid-morning, at most one a day for each person.

export function leaveReminder(candidateId: string, dueOn: string, message: string): void {
  const db = getDb()
  // One for that day is enough: a second one replaces it.
  db.prepare('DELETE FROM whatsapp_reminders WHERE candidate_id = ? AND due_on = ? AND sent_at IS NULL').run(candidateId, dueOn)
  db.prepare('INSERT INTO whatsapp_reminders (id, candidate_id, due_on, message, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId('rem'),
    candidateId,
    dueOn,
    message,
    now(),
  )
}

// What is still to come, for the agent to know it already said it would ask.
export function pendingReminders(candidateId: string): { on: string; message: string }[] {
  return (
    getDb()
      .prepare('SELECT due_on AS "on", message FROM whatsapp_reminders WHERE candidate_id = ? AND sent_at IS NULL ORDER BY due_on')
      .all(candidateId) as unknown as { on: string; message: string }[]
  ).slice(0, 5)
}

export async function sendDueReminders(): Promise<{ sent: number; skipped: number }> {
  const stats = { sent: 0, skipped: 0 }
  const config = zernioConfig()
  if (!config) return stats
  const today = new Date().toISOString().slice(0, 10)
  const due = getDb()
    .prepare('SELECT id, candidate_id, message FROM whatsapp_reminders WHERE sent_at IS NULL AND due_on <= ? ORDER BY due_on')
    .all(today) as unknown as { id: string; candidate_id: string; message: string }[]
  const done = new Set<string>()
  for (const reminder of due) {
    // Paused: kept, and sent if still due once they resume it.
    if (done.has(reminder.candidate_id) || isSearchPaused(reminder.candidate_id)) continue
    const link = linkOf(reminder.candidate_id)
    const open = link ? windowOpen(link) : false
    // The shared test number only writes inside the 24 hours.
    if (!link?.conversation_id || (!open && config.sandbox)) {
      stats.skipped++
      continue
    }
    try {
      await sendMessage(config, { conversationId: link.conversation_id, text: reminder.message, utility: !open, idempotencyKey: `rem:${reminder.id}` })
      getDb().prepare('UPDATE whatsapp_reminders SET sent_at = ? WHERE id = ?').run(now(), reminder.id)
      logMessage(reminder.candidate_id, 'out', reminder.message)
      done.add(reminder.candidate_id)
      stats.sent++
    } catch {
      stats.skipped++
    }
  }
  return stats
}

// Those whose day went by while the search was paused: said late, they would
// be about an interview or a deadline already past.
export function dropPastReminders(candidateId: string): void {
  getDb()
    .prepare('DELETE FROM whatsapp_reminders WHERE candidate_id = ? AND sent_at IS NULL AND due_on < ?')
    .run(candidateId, new Date().toISOString().slice(0, 10))
}
