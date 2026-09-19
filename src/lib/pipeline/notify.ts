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

import { getSmtpConfig, getTelegramConfig, smtpProblem } from '@/lib/features'
import { sendMail } from '@/lib/notify/smtp'
import { sendTelegramMessage } from '@/lib/notify/telegram'
import { getInterruptionFor, type InterruptionView } from '../opportunity-view'
import { getOpportunity, getQuestion, recordAuditEvent } from '../db/opportunities'
import {
  getNotification,
  insertNotification,
  listUnsentNotifications,
  markNotificationFailed,
  markNotificationQueued,
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

/**
 * A question is not an interruption, and must not read like one.
 *
 * An interruption says "this is worth your evening". This says "I need one
 * thing before I can tell you whether it is" — a smaller ask, and it has to
 * look smaller, or the second time one arrives nobody opens it.
 */
export function questionBodyFor(input: {
  company: string
  role: string
  question: string
  reason: string
}): string {
  return [
    'One thing before I can say.',
    '',
    `Something came in for ${input.role} at ${input.company}, and it turns on a detail I cannot`,
    'settle from what I already know about you:',
    '',
    input.question,
    '',
    'Answering takes a line. If the answer closes it, I will tell you what I decided;',
    'if it does not, you will not hear about this one again.',
    '',
    `Answer here: ${baseUrl()}/listening`,
    '',
    'I have not told them anything, and nothing goes to them until you say so.',
  ].join('\n')
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
  const channels: NotificationChannel[] = preferences.notifyChannels

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
    const address = addressFor(preferences, channel)
    const deliverable = Boolean(address) && configuredFor(channel)
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

/**
 * The same envelope as an interruption, for a smaller thing.
 *
 * It travels the same way on purpose: one outbox, one delivery job, one set
 * of retries. A second path for "small" messages is a second path to get
 * wrong.
 */
export function queueQuestionNotice(candidateId: string, questionId: string): QueuedNotice[] {
  const question = getQuestion(questionId)
  if (!question) return []
  const opportunity = getOpportunity(question.opportunity_id)
  if (!opportunity) return []

  const preferences = readPreferences(candidateId)
  const subject = `Your Rep needs one thing: ${opportunity.role} at ${opportunity.company}`
  const body = questionBodyFor({
    company: opportunity.company,
    role: opportunity.role,
    question: question.question,
    reason: question.reason,
  })

  const queued: QueuedNotice[] = []
  for (const channel of preferences.notifyChannels) {
    const address = addressFor(preferences, channel)
    const deliverable = Boolean(address) && configuredFor(channel)
    const result = insertNotification({
      candidate_id: candidateId,
      channel,
      address,
      subject,
      body,
      about_type: 'question',
      about_id: questionId,
      status: deliverable ? 'pending' : 'unconfigured',
    })
    queued.push({ notification: result.notification, created: result.created })
    if (result.created && deliverable) {
      enqueue('deliver_notification', candidateId, { notificationId: result.notification.id })
    }
  }
  return queued
}

function addressFor(
  preferences: ReturnType<typeof readPreferences>,
  channel: NotificationChannel,
): string | null {
  if (channel === 'email') return preferences.notifyEmail
  if (channel === 'telegram') return preferences.notifyTelegram
  return preferences.notifyWhatsapp
}

/** Whether there is anything on the server end of this channel at all. */
function configuredFor(channel: NotificationChannel): boolean {
  if (channel === 'email') return getSmtpConfig() !== null
  if (channel === 'telegram') return getTelegramConfig() !== null
  // WhatsApp needs a provider and a template Meta approved in advance. It is
  // written down and left unsent rather than pretended away.
  return false
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

/**
 * Send what was written while there was nowhere to send it.
 *
 * The first time a channel is configured, every interruption decided before
 * that moment is sitting in the outbox marked `unconfigured`. Leaving them
 * there would mean the setup only takes effect for the next opportunity,
 * and the five already waiting would never arrive — which is a strange thing
 * for a product whose whole promise is that it tells you.
 *
 * Safe to call as often as you like: a row only moves when its channel is
 * configured now and there is an address to use, and the address is taken
 * from the current preferences rather than whatever was true when it was
 * written.
 */
export function resumeUnsentNotices(candidateId: string): number {
  const preferences = readPreferences(candidateId)
  let resumed = 0

  for (const notification of listUnsentNotifications(candidateId)) {
    const channel = notification.channel
    if (!preferences.notifyChannels.includes(channel)) continue
    const address = addressFor(preferences, channel)
    if (!address || !configuredFor(channel)) continue

    markNotificationQueued(notification.id, address)
    enqueue('deliver_notification', candidateId, { notificationId: notification.id })
    resumed += 1
  }
  return resumed
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

  if (!notification.address) {
    markNotificationFailed(notification.id, 'No address to send it to.', 'unconfigured')
    return
  }

  const send = deliveryFor(notification)
  if (!send) {
    markNotificationFailed(notification.id, unconfiguredReason(notification.channel), 'unconfigured')
    return
  }

  try {
    await send()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The message did not go out.'
    markNotificationFailed(notification.id, message, 'failed')
    // Throwing is how a retry is asked for. A refusal is not a reason to ask
    // for one: the server said no and will say no again, and four more
    // attempts only bury the reason somebody needs to read.
    if ((error as { permanent?: boolean }).permanent === true) return
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

/**
 * How this one would actually go out, or null if there is no way to.
 *
 * Each channel gets exactly one place where it is sent, and the shape of the
 * message never changes between them: what the screen says, word for word.
 * Only the envelope differs.
 */
function deliveryFor(notification: NotificationRow): (() => Promise<void>) | null {
  const address = notification.address
  if (!address) return null

  if (notification.channel === 'email') {
    const config = getSmtpConfig()
    return config
      ? () => sendMail(config, { to: address, subject: notification.subject, text: notification.body })
      : null
  }

  if (notification.channel === 'telegram') {
    const config = getTelegramConfig()
    return config ? () => sendTelegramMessage(config, address, notification.body) : null
  }

  return null
}

function unconfiguredReason(channel: NotificationChannel): string {
  // Say which part is missing. "Not configured" sends somebody to read the
  // whole env file looking for the one line they left blank.
  if (channel === 'email') return smtpProblem() ?? 'The mail server is not usable.'
  if (channel === 'telegram') {
    return 'No bot is configured. Set AMBLE_TELEGRAM_BOT_TOKEN.'
  }
  return 'WhatsApp needs a provider and a template approved in advance. Nothing is sent yet.'
}
