/**
 * Getting the one message out of the machine.
 *
 * The listening screen promises "you get one message". Until now that
 * message only existed if the person happened to have the tab open, which
 * is the opposite of the promise: Amble is meant to be the thing you can
 * walk away from.
 *
 * What is sent says exactly what the screen says — same headline, same
 * evidence, same open questions — because two versions of why somebody is
 * being interrupted is two products. Both come from `getInterruptionFor`.
 *
 * Sending runs on the queue like everything else that touches a network, so
 * a mail server that is down at midnight is the same kind of problem as a
 * model that times out, with the same backoff and the same recovery.
 */

import { getSmtpConfig } from '@/lib/features'
import { sendMail } from '@/lib/notify/smtp'
import { getInterruptionFor, type InterruptionView } from '../opportunity-view'
import { recordAuditEvent } from '../db/opportunities'
import {
  getNotification,
  insertNotification,
  markNotificationFailed,
  markNotificationSent,
  type NotificationChannel,
  type NotificationRow,
} from '../db/notifications'
import { readPreferences } from './preferences'
import { enqueue } from './jobs'

/** Where the message tells them to go to answer. */
function baseUrl(): string {
  return (process.env.AMBLE_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '')
}

// ─── What it says ─────────────────────────────────────────────────────────

export function subjectFor(interruption: InterruptionView): string {
  return `Your Rep found something: ${interruption.role} at ${interruption.company}`
}

/**
 * The screen, in plain text.
 *
 * No HTML and no images. This is a letter from something that has been
 * quietly working on your behalf, and it should read like one — and it
 * should still read like one in a client that shows nothing but text.
 */
export function bodyFor(interruption: InterruptionView): string {
  const lines: string[] = ['Your Rep found something.', '', interruption.headline, '']

  lines.push(`${interruption.role} · ${interruption.company}`)
  for (const fact of interruption.facts) lines.push(`${fact.label}: ${fact.value}`)
  if (interruption.url) lines.push(`The posting: ${interruption.url}`)

  lines.push('', "WHY I'M SHOWING YOU THIS", interruption.whyShowing)

  if (interruption.whyYou.length > 0) {
    lines.push('', 'WHY YOU')
    for (const claim of interruption.whyYou) {
      lines.push(`- ${claim.text}`)
      // The evidence itself, not a reference to it: it has to be checkable
      // from the message, by someone who never opens the app.
      for (const statement of claim.evidence) lines.push(`    ${statement}`)
    }
  }

  if (interruption.whatToConsider.length > 0) {
    lines.push('', "WHAT I DON'T KNOW YET")
    for (const item of interruption.whatToConsider) lines.push(`- ${item}`)
  }

  lines.push(
    '',
    `Answer here: ${baseUrl()}/listening`,
    '',
    'Nothing has gone to the company, and nothing will until you say so.',
  )

  return lines.join('\n')
}

// ─── Getting it queued ────────────────────────────────────────────────────

export interface QueuedNotice {
  notification: NotificationRow
  created: boolean
}

/**
 * Write the message down and put its delivery on the queue.
 *
 * Writing comes first and is what makes it safe to call twice: the outbox
 * has a unique index over (what it is about, which channel), so a
 * re-evaluation after a restart finds the row already there and enqueues
 * nothing.
 */
export function queueInterruptionNotice(
  candidateId: string,
  opportunityId: string,
): QueuedNotice[] {
  const interruption = getInterruptionFor(opportunityId)
  if (!interruption) return []

  const preferences = readPreferences(candidateId)
  const channels: NotificationChannel[] =
    preferences.notifyChannel === 'both'
      ? ['email', 'whatsapp']
      : preferences.notifyChannel === 'email'
        ? ['email']
        : preferences.notifyChannel === 'whatsapp'
          ? ['whatsapp']
          : []

  // They never said where. The interruption still exists and still shows on
  // the screen; there is simply nowhere to send it, and that is worth a row
  // rather than nothing, because "we never told you" needs a reason.
  if (channels.length === 0) {
    return [
      record(candidateId, opportunityId, interruption, 'email', null, 'unconfigured'),
    ]
  }

  const queued: QueuedNotice[] = []
  for (const channel of channels) {
    const address =
      channel === 'email' ? preferences.notifyEmail : preferences.notifyWhatsapp
    const deliverable = channel === 'email' && Boolean(address) && getSmtpConfig() !== null
    const notice = record(
      candidateId,
      opportunityId,
      interruption,
      channel,
      address,
      deliverable ? 'pending' : 'unconfigured',
    )
    queued.push(notice)
    if (notice.created && deliverable) {
      enqueue('deliver_notification', candidateId, { notificationId: notice.notification.id })
    }
  }
  return queued
}

function record(
  candidateId: string,
  opportunityId: string,
  interruption: InterruptionView,
  channel: NotificationChannel,
  address: string | null,
  status: 'pending' | 'unconfigured',
): QueuedNotice {
  const result = insertNotification({
    candidate_id: candidateId,
    channel,
    address,
    subject: subjectFor(interruption),
    body: bodyFor(interruption),
    about_type: 'opportunity',
    about_id: opportunityId,
    status,
  })

  if (result.created) {
    recordAuditEvent({
      candidate_id: candidateId,
      subject_type: 'opportunity',
      subject_id: opportunityId,
      event: 'notification_queued',
      detail: { channel, status, hasAddress: Boolean(address) },
    })
  }
  return { notification: result.notification, created: result.created }
}

// ─── Getting it sent ──────────────────────────────────────────────────────

/**
 * One delivery attempt, run by the queue.
 *
 * Throwing is how a retry is asked for; the queue's backoff is the right
 * place for "the mail server was busy". A misconfiguration is not thrown —
 * waiting five more minutes will not configure anything — so it is written
 * down as `unconfigured` and the job finishes.
 */
export async function deliverNotificationJob(notificationId: string): Promise<void> {
  const notification = getNotification(notificationId)
  if (!notification) throw new Error(`Notification ${notificationId} is gone.`)
  if (notification.status === 'sent') return

  if (notification.channel !== 'email') {
    markNotificationFailed(
      notification.id,
      `There is no way to send a ${notification.channel} message yet.`,
      'unconfigured',
    )
    return
  }
  if (!notification.address) {
    markNotificationFailed(notification.id, 'No address to send it to.', 'unconfigured')
    return
  }

  const config = getSmtpConfig()
  if (!config) {
    markNotificationFailed(
      notification.id,
      'No mail server is configured. Set AMBLE_SMTP_HOST and AMBLE_SMTP_FROM.',
      'unconfigured',
    )
    return
  }

  try {
    await sendMail(config, {
      to: notification.address,
      subject: notification.subject,
      text: notification.body,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The message did not go out.'
    markNotificationFailed(notification.id, message, 'failed')
    throw error
  }

  markNotificationSent(notification.id)
  recordAuditEvent({
    candidate_id: notification.candidate_id,
    subject_type: 'opportunity',
    subject_id: notification.about_id,
    event: 'notification_sent',
    detail: { channel: notification.channel, attempts: notification.attempts + 1 },
  })
}
