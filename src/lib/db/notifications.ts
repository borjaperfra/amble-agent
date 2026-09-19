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
/**
 * `obsolete` is the fifth: written, never sent, and no longer true by the
 * time there was somewhere to send it. A question answered on the screen
 * three hours ago must not arrive on a phone as "one thing before I can
 * say" — the person would answer it again, and be told there was nothing
 * open.
 */
export type NotificationStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'unconfigured'
  | 'obsolete'

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
  /** What the far side called it: a Telegram message id, once sent. */
  external_id: string | null
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

/**
 * Overtaken by events.
 *
 * Kept rather than deleted, with the reason: "we never told you" needs an
 * answer, and so does "you told me about something I had already dealt
 * with". It never comes back to the queue.
 */
export function markNotificationObsolete(id: string, reason: string): void {
  getDb()
    .prepare("UPDATE notifications SET status = 'obsolete', last_error = ? WHERE id = ?")
    .run(reason.slice(0, 500), id)
}

/** What the channel called the message it just delivered. */
export function setNotificationExternalId(id: string, externalId: string): void {
  getDb().prepare('UPDATE notifications SET external_id = ? WHERE id = ?').run(externalId, id)
}

/**
 * The message they are replying to.
 *
 * This is what makes several things in flight at once safe: without it, an
 * answer is assumed to be about the oldest open question, and somebody
 * working down four messages on their phone would have three of their
 * answers filed against the wrong one.
 */
export function findNotificationByExternalId(
  channel: NotificationChannel,
  externalId: string,
): NotificationRow | undefined {
  return getDb()
    .prepare('SELECT * FROM notifications WHERE channel = ? AND external_id = ?')
    .get(channel, externalId) as unknown as NotificationRow | undefined
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

/**
 * Written, and never sent.
 *
 * `unconfigured` is not a dead end: the channel it was waiting for can be
 * set up afterwards, which is exactly what happens the first time — every
 * interruption decided before the mail server existed is sitting here.
 */
export function listUnsentNotifications(candidateId: string): NotificationRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM notifications
       WHERE candidate_id = ? AND status IN ('unconfigured', 'failed')
       ORDER BY created_at`,
    )
    .all(candidateId) as unknown as NotificationRow[]
}

/**
 * Rewrite one that never went out.
 *
 * Only ever called for a row that is still waiting: a sent message is a
 * thing somebody has read, and editing our copy of it afterwards would make
 * the outbox a worse record than their inbox.
 */
export function updateNotificationBody(id: string, body: string): void {
  getDb()
    .prepare("UPDATE notifications SET body = ? WHERE id = ? AND status <> 'sent'")
    .run(body, id)
}

/** Back on the queue, with whatever address is current. */
export function markNotificationQueued(id: string, address: string): void {
  getDb()
    .prepare("UPDATE notifications SET status = 'pending', address = ?, last_error = NULL WHERE id = ?")
    .run(address, id)
}
