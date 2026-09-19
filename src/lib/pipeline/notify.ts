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
import { copyIn, DEFAULT_LANGUAGE, type Language } from '@/lib/copy'
import { sendMail } from '@/lib/notify/smtp'
import { sendTelegramMessage } from '@/lib/notify/telegram'
import { getInterruptionFor, type InterruptionView } from '../opportunity-view'
import {
  getOpportunity,
  getQuestion,
  listPendingInterruptions,
  recordAuditEvent,
} from '../db/opportunities'
import {
  getNotification,
  insertNotification,
  listUnsentNotifications,
  markNotificationFailed,
  markNotificationQueued,
  markNotificationObsolete,
  markNotificationSent,
  setNotificationExternalId,
  updateNotificationBody,
  type NotificationChannel,
  type NotificationRow,
} from '../db/notifications'
import { readPreferences } from './preferences'
import { enqueue } from './jobs'

/** Where the message tells them to go to answer. */
export function baseUrl(): string {
  return (process.env.AMBLE_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '')
}

// ─── What it says ─────────────────────────────────────────────────────────

export function subjectFor(
  interruption: InterruptionView,
  language: Language = DEFAULT_LANGUAGE,
): string {
  return copyIn(language).interruptionSubject(interruption.role, interruption.company)
}

/**
 * La pantalla, en texto.
 *
 * Sin HTML y sin imágenes. Esto es una nota de algo que lleva un rato
 * trabajando por ti, y tiene que leerse como una nota — también en un
 * cliente que solo enseña texto.
 *
 * Corto donde se puede y largo donde hace falta: la explicación es el
 * producto, así que la evidencia va entera. Lo que se ha quitado son las
 * frases que no dicen nada.
 */
export function bodyFor(
  interruption: InterruptionView,
  channel: NotificationChannel = 'email',
  language: Language = DEFAULT_LANGUAGE,
): string {
  const copy = copyIn(language)
  const lines: string[] = [interruption.headline, '']

  lines.push(`${interruption.role} · ${interruption.company}`)
  for (const fact of interruption.facts) lines.push(`${fact.label}: ${fact.value}`)
  if (interruption.url) lines.push(copy.posting(interruption.url))

  lines.push('', copy.whyShowing, interruption.whyShowing)

  if (interruption.whyYou.length > 0) {
    lines.push('', copy.whyYou)
    for (const claim of interruption.whyYou) {
      lines.push(`- ${claim.text}`)
      // La evidencia, no una referencia a ella: tiene que poder comprobarse
      // desde el mensaje, sin abrir nada.
      for (const statement of claim.evidence) lines.push(`    ${statement}`)
    }
  }

  if (interruption.whatToConsider.length > 0) {
    lines.push('', copy.whatToConsider)
    for (const item of interruption.whatToConsider) lines.push(`- ${item}`)
  }

  lines.push('', ...howToAnswer(channel, language), '', copy.nothingSent)

  return lines.join('\n')
}

/**
 * Una pregunta no es una interrupción y no puede leerse como una.
 *
 * Una interrupción dice "esto merece tu tarde". Esto dice "me falta una cosa
 * para saber si la merece": es menos, y tiene que parecer menos, o la
 * segunda vez que llegue una no la abre nadie.
 */
export function questionBodyFor(input: {
  company: string
  role: string
  question: string
  reason: string
  channel?: NotificationChannel
  language?: Language
}): string {
  const copy = copyIn(input.language ?? DEFAULT_LANGUAGE)
  return [
    copy.questionLead(input.role, input.company),
    '',
    input.question,
    '',
    ...(input.channel === 'telegram'
      ? copy.questionTailReply
      : copy.questionTailScreen(baseUrl())),
    copy.questionPromise,
  ].join('\n')
}

/**
 * Cómo contestar, que es lo único que depende de por dónde llegó.
 *
 * Todo lo de arriba es idéntico en los dos canales y tiene que seguir
 * siéndolo. Esto es el sobre: en Telegram la respuesta vuelve por donde
 * vino, y mandar a alguien a un portátil a escribir un sí que podía escribir
 * con el pulgar es justo lo que esto vino a quitar.
 */
function howToAnswer(channel: NotificationChannel, language: Language): string[] {
  const copy = copyIn(language)
  return [channel === 'telegram' ? copy.answerByCommand : copy.answerOnScreen(baseUrl())]
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
  const language = preferences.language
  const channels: NotificationChannel[] = preferences.notifyChannels

  // They never said where. The interruption still exists and still shows on
  // the screen; there is simply nowhere to send it, and that is worth a row
  // rather than nothing, because "we never told you" needs a reason.
  if (channels.length === 0) {
    return [
      record(candidateId, opportunityId, interruption, 'email', null, 'unconfigured', language),
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
      language,
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
  const copy = copyIn(preferences.language)
  const subject = copy.questionSubject(opportunity.role, opportunity.company)

  const queued: QueuedNotice[] = []
  for (const channel of preferences.notifyChannels) {
    const address = addressFor(preferences, channel)
    const deliverable = Boolean(address) && configuredFor(channel)
    const result = insertNotification({
      candidate_id: candidateId,
      channel,
      address,
      subject,
      // Same question, same reason, and only the last line differs: on
      // Telegram the answer comes back by replying, and nothing sends them
      // to a screen to type what they could type where they are.
      body: questionBodyFor({
        company: opportunity.company,
        role: opportunity.role,
        question: question.question,
        reason: question.reason,
        channel,
        language: preferences.language,
      }),
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
  language: Language,
): QueuedNotice {
  const result = insertNotification({
    candidate_id: candidateId,
    channel,
    address,
    subject: subjectFor(interruption, language),
    body: bodyFor(interruption, channel, language),
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

  const pending = new Set(listPendingInterruptions(candidateId).map((item) => item.opportunity.id))

  for (const notification of listUnsentNotifications(candidateId)) {
    const channel = notification.channel
    if (!preferences.notifyChannels.includes(channel)) continue

    // Still true? Setting a channel up months later must not deliver a
    // question somebody already answered on the screen. They would answer it
    // again — carefully, because it was asked carefully — and be told there
    // was nothing open. Measured the hard way, on the first real run.
    const reason = staleReason(notification, pending, preferences.language)
    if (reason) {
      markNotificationObsolete(notification.id, reason)
      continue
    }

    const address = addressFor(preferences, channel)
    if (!address || !configuredFor(channel)) continue

    // Written for nowhere in particular, and now going somewhere specific.
    // The one line that depends on the channel is the line telling them how
    // to answer, and a message that arrives on Telegram saying "answer on
    // the screen" is the exact thing this was built to stop.
    const rewritten = rebuild(notification, preferences.language)
    if (rewritten && rewritten !== notification.body) {
      updateNotificationBody(notification.id, rewritten)
    }

    markNotificationQueued(notification.id, address)
    enqueue('deliver_notification', candidateId, { notificationId: notification.id })
    resumed += 1
  }
  return resumed
}

/**
 * Why this one should not go out after all, or null if it still should.
 *
 * Only about things that have since been settled. A message that is merely
 * old is still worth sending: the whole point of the outbox is that a week
 * without a mail server does not cost somebody an opportunity.
 */
function staleReason(
  notification: NotificationRow,
  pendingInterruptions: Set<string>,
  language: Language,
): string | null {
  const copy = copyIn(language)

  if (notification.about_type === 'question') {
    const question = getQuestion(notification.about_id)
    if (!question) return copy.stale.questionGone
    if (question.status !== 'open') return copy.stale.answeredFirst
    return null
  }

  if (notification.about_type === 'opportunity') {
    if (!pendingInterruptions.has(notification.about_id)) {
      return copy.stale.noLongerInterruption
    }
  }
  return null
}

/**
 * The same message, said the way this channel says it.
 *
 * Only what the builders produce now, and only for something still waiting:
 * if the decision behind it is gone or has changed, the stored text stays as
 * it is rather than being quietly replaced with something else.
 */
function rebuild(notification: NotificationRow, language: Language): string | null {
  if (notification.about_type === 'opportunity') {
    const interruption = getInterruptionFor(notification.about_id)
    return interruption ? bodyFor(interruption, notification.channel, language) : null
  }

  if (notification.about_type === 'question') {
    const question = getQuestion(notification.about_id)
    const opportunity = question ? getOpportunity(question.opportunity_id) : null
    if (!question || !opportunity) return null
    return questionBodyFor({
      company: opportunity.company,
      role: opportunity.role,
      question: question.question,
      reason: question.reason,
      channel: notification.channel,
      language,
    })
  }

  return null
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

  let externalId: string | null = null
  try {
    externalId = await send()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The message did not go out.'
    markNotificationFailed(notification.id, message, 'failed')
    // Throwing is how a retry is asked for. A refusal is not a reason to ask
    // for one: the server said no and will say no again, and four more
    // attempts only bury the reason somebody needs to read.
    if ((error as { permanent?: boolean }).permanent === true) return
    throw error
  }

  // Before it is marked sent: this is what a reply will quote, and a reply
  // that arrives before we have written the id down has nothing to match.
  if (externalId) setNotificationExternalId(notification.id, externalId)

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
function deliveryFor(notification: NotificationRow): (() => Promise<string | null>) | null {
  const address = notification.address
  if (!address) return null

  if (notification.channel === 'email') {
    const config = getSmtpConfig()
    return config
      ? async () => {
          await sendMail(config, {
            to: address,
            subject: notification.subject,
            text: notification.body,
          })
          // SMTP hands back a queue id that means nothing to us: there is no
          // inbound path on this channel to match it against.
          return null
        }
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
