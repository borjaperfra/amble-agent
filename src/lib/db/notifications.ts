/**
 * The outbox.
 *
 * Kept apart from `repo.ts` for the same reason the opportunity tables are:
 * User Zero works and is frozen, and this is new. Nothing in here knows what
 * a notification says — only that one exists, what state it is in, and what
 * the server said the last time we tried.
 */

import { getDb } from './db'
import { newId, now } from './repo'

export type NotificationChannel = 'email' | 'whatsapp' | 'telegram'

/**
 * `unconfigured` is a real outcome, not a failure. There is a difference
 * between a server that refused the message and a channel nobody set up, and
 * the person waiting for the message is entitled to know which one they have.
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'unconfigured'

export interface NotificationRow {
  id: string
  candidate_id: string
  channel: NotificationChannel
  address: string | null
  subject: string
  body: string
  about_type: string
  about_id: string
  status: NotificationStatus
  attempts: number
  last_error: string | null
  created_at: string
  sent_at: string | null
}

/**
 * Write it once. A second call for the same interruption on the same channel
 * returns what is already there rather than queueing another copy — a
 * re-evaluation after a restart must not mean a second message.
 */
export function insertNotification(row: {
  candidate_id: string
  channel: NotificationChannel
  address: string | null
  subject: string
  body: string
  about_type: string
  about_id: string
  status: NotificationStatus
}): { notification: NotificationRow; created: boolean } {
  const existing = findNotification(row.about_type, row.about_id, row.channel)
  if (existing) return { notification: existing, created: false }

  const id = newId('note')
  getDb()
    .prepare(
      `INSERT INTO notifications
         (id, candidate_id, channel, address, subject, body, about_type, about_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.candidate_id,
      row.channel,
      row.address,
      row.subject,
      row.body,
      row.about_type,
      row.about_id,
      row.status,
      now(),
    )
  return { notification: getNotification(id) as NotificationRow, created: true }
}

export function getNotification(id: string): NotificationRow | undefined {
  return getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(id) as unknown as
    | NotificationRow
    | undefined
}

export function findNotification(
  aboutType: string,
  aboutId: string,
  channel: NotificationChannel,
): NotificationRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM notifications WHERE about_type = ? AND about_id = ? AND channel = ?',
    )
    .get(aboutType, aboutId, channel) as unknown as NotificationRow | undefined
}

export function markNotificationSent(id: string): void {
  getDb()
    .prepare(
      "UPDATE notifications SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?",
    )
    .run(now(), id)
}

export function markNotificationFailed(id: string, error: string, status: NotificationStatus): void {
  getDb()
    .prepare('UPDATE notifications SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?')
    .run(status, error.slice(0, 500), id)
}

export function listNotifications(candidateId: string, limit = 50): NotificationRow[] {
  return getDb()
    .prepare('SELECT * FROM notifications WHERE candidate_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(candidateId, limit) as unknown as NotificationRow[]
}
