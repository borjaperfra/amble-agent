/**
 * The answer, coming back on its own.
 *
 * Until now every loop in Amble ended at a screen. A question left by email
 * saying "answer here", and answering meant finding the tab, which is the
 * one thing this product is supposed to spare somebody. The interruption has
 * the same problem from the other side: the message arrives on a phone and
 * the yes lives on a laptop.
 *
 * So: the same shape, closed. A question leaves through the outbox, the
 * answer arrives here, the graph changes, and the opportunity is decided
 * again — without the app being open at any point.
 *
 * Nothing new decides anything. This is a transport, and it hands what it
 * receives to the two functions that already existed. That matters beyond
 * the convenience: the far end of this loop is meant to be another agent
 * rather than a person, and machinery that only works with a tab open was
 * never really a loop.
 */

import { getTelegramConfig, getTelegramPollIntervalMs, type TelegramConfig } from '@/lib/features'
import { copyIn, type RepCopy } from '@/lib/copy'
import type { CandidateResponse } from '@/domains/opportunity/types'
import {
  fetchUpdates,
  fetchVoice,
  sendTelegramMessage,
  type InboundTelegramMessage,
} from '@/lib/notify/telegram'
import { transcribeAudio, TranscriptionError } from '@/lib/model/transcribe'
import {
  claimInboundMessage,
  lastInboundExternalId,
  recordInboundTranscript,
  settleInboundMessage,
  type InboundOutcome,
} from '../db/inbound'
import {
  getOpportunity,
  getQuestion,
  listAuditEvents,
  listOpenQuestions,
  listPendingInterruptions,
  recordAuditEvent,
  type OpportunityQuestionRow,
} from '../db/opportunities'
import { findNotificationByExternalId, type NotificationRow } from '../db/notifications'
import { answerQuestion } from './opportunity-questions'
import { recordCandidateResponse } from './opportunities'
import { baseUrl } from './notify'
import { readPreferences } from './preferences'
import { enqueue, hasQueuedKind } from './jobs'

// ─── What they meant ──────────────────────────────────────────────────────

export type InboundCommand = 'start' | 'help' | 'yes' | 'no'

export interface ClassifiedMessage {
  command: InboundCommand | null
  text: string
}

/**
 * A command, or words.
 *
 * Only a command decides anything. "Yes" typed as a word is not a yes: when
 * a question is open, "yes, I ran that community for two years" is an
 * answer, and reading its first word as a verdict on some other job would be
 * the kind of helpfulness that costs somebody an evening.
 *
 * Telegram appends the bot's username to commands — `/no@rep_bot` — which is
 * the same command and has to be read as one.
 */
export function classifyMessage(raw: string): ClassifiedMessage {
  const text = raw.trim()
  const match = /^\/([a-z]+)(@\w+)?$/i.exec(text)
  if (!match) return { command: null, text }

  const word = match[1].toLowerCase()
  if (word === 'start' || word === 'help') return { command: word, text }
  if (word === 'si' || word === 'yes' || word === 's') return { command: 'yes', text }
  if (word === 'no' || word === 'n') return { command: 'no', text }
  return { command: null, text }
}

// ─── What to do about it ──────────────────────────────────────────────────

export interface HandledMessage {
  outcome: InboundOutcome
  about: { type: string; id: string } | null
  /** What to say back. Nothing is said back to a chat we do not know. */
  reply: string | null
  detail?: string
  /**
   * Words that nothing here consumed, and that still belong in the profile.
   *
   * Set wherever a message was not taken as the answer to something: nothing
   * open, a reply to a question already closed, words where a yes was
   * needed. An answer is not flagged, because it is already on its way into
   * the graph by the door built for it and two doors means two claims.
   */
  asContext?: boolean
}

/**
 * What the words are worth here, in the order of what is waiting.
 *
 * The first question is which message they are replying to. Telegram's own
 * reply UI puts that in the update for free, and it is what makes several
 * things in flight at once safe: on the first real run four messages went
 * out at once, and without the quote every answer after the first was either
 * filed against the oldest open question or told there was nothing open.
 *
 * After that the order is the whole of it. A command is a command.
 * Otherwise, if a question is open, whatever they wrote is its answer — all
 * of it, unparsed, because the extractor downstream reads a sentence better
 * than a regular expression does.
 *
 * What is left over is not nothing. A message with no question behind it
 * used to be acknowledged and dropped, which made the Rep a form with
 * conversation on top: tell it you have moved, and the next opportunity asks
 * where you live. Those branches now carry `asContext`, and what they wrote
 * goes into the profile by the same door an answer does.
 *
 * Nothing is thrown away quietly: every branch returns an outcome that gets
 * written down next to what they sent.
 */
export function handleMessage(
  candidateId: string,
  raw: string,
  replyToMessageId: number | null = null,
): HandledMessage {
  const { command, text } = classifyMessage(raw)
  const copy = copyIn(readPreferences(candidateId).language)
  const quoted = replyToMessageId
    ? (findNotificationByExternalId('telegram', String(replyToMessageId)) ?? null)
    : null

  if (command === 'start' || command === 'help') {
    return { outcome: 'greeted', about: null, reply: copy.bot.greeting.join('\n') }
  }

  if (command === 'yes' || command === 'no') {
    return respondToInterruption(
      candidateId,
      command === 'yes' ? 'HEAR_THEM_OUT' : 'NOT_FOR_ME',
      quoted,
      copy,
    )
  }

  if (text.length === 0) {
    return {
      outcome: 'ignored',
      about: null,
      detail: 'nothing readable in the message',
      reply: copy.bot.unreadable,
    }
  }

  if (quoted) {
    const routed = answerQuoted(candidateId, quoted, text, copy)
    if (routed) return routed
  }

  const open = listOpenQuestions(candidateId)
  if (open.length > 0) return answerOne(open[0], text, open.length > 1, copy)

  const pending = listPendingInterruptions(candidateId)
  if (pending.length === 1) {
    const { opportunity } = pending[0]
    return {
      outcome: 'ambiguous',
      about: { type: 'opportunity', id: opportunity.id },
      detail: 'words arrived while an interruption was waiting for a yes or a no',
      asContext: true,
      reply: copy.bot.waitingOnYou(opportunity.role, opportunity.company).join('\n'),
    }
  }

  return {
    outcome: 'noted_as_context',
    about: null,
    asContext: true,
    reply: copy.bot.notedAsContext.join('\n'),
  }
}

/**
 * The message they quoted, and what it was about.
 *
 * Returns null when the quote settles nothing — a reply to my own "thank
 * you", say — and the ordinary order takes over from there.
 */
function answerQuoted(
  candidateId: string,
  quoted: NotificationRow,
  text: string,
  copy: RepCopy,
): HandledMessage | null {
  if (quoted.about_type === 'question') {
    const question = getQuestion(quoted.about_id)
    if (!question) return null
    if (question.status === 'open') return answerOne(question, text, false, copy)

    // The one that actually happened: four messages arrive at once, three of
    // them about questions answered hours earlier on the screen, and nothing
    // on the phone says so. Naming it and saying it is closed is the least
    // this owes somebody who sat and answered it a second time.
    return {
      outcome: 'already_settled',
      about: { type: 'question', id: question.id },
      detail: 'a reply to a question that was already answered',
      asContext: true,
      reply: copy.bot.alreadyAnswered(about(question.opportunity_id, copy)).join('\n'),
    }
  }

  if (quoted.about_type === 'opportunity') {
    const waiting = listPendingInterruptions(candidateId).some(
      (item) => item.opportunity.id === quoted.about_id,
    )
    if (waiting) {
      return {
        outcome: 'ambiguous',
        about: { type: 'opportunity', id: quoted.about_id },
        detail: 'words arrived where a yes or a no was needed',
        asContext: true,
        reply: copy.bot.needsYesNo(about(quoted.about_id, copy)).join('\n'),
      }
    }
    return {
      outcome: 'already_settled',
      about: { type: 'opportunity', id: quoted.about_id },
      detail: 'a reply to an interruption that was already answered',
      asContext: true,
      reply: copy.bot.alreadyResponded(about(quoted.about_id, copy)),
    }
  }

  return null
}

/**
 * Take it as the answer to this question, and say which one it went on.
 *
 * Naming the role is not decoration. On a screen there is one question in
 * front of them; in a chat there may be four, hours apart, and an answer
 * that disappears into "noted" leaves them no way to know it landed where
 * they meant it to.
 */
function answerOne(
  question: OpportunityQuestionRow,
  text: string,
  othersOpen: boolean,
  copy: RepCopy,
): HandledMessage {
  const result = answerQuestion(question.id, text)
  if (!result.ok) {
    return {
      outcome: 'failed',
      about: { type: 'question', id: question.id },
      detail: result.error,
      reply: copy.bot.couldNotWrite(result.error),
    }
  }

  // Lo mismo que dice la pantalla al contestar: el mismo momento contado de
  // dos maneras son dos productos.
  const lines = copy.bot.noted(about(question.opportunity_id, copy))
  if (othersOpen) lines.push(...copy.bot.othersOpen)

  return {
    outcome: 'answered_question',
    about: { type: 'question', id: question.id },
    reply: lines.join('\n'),
  }
}

/** " — Head of Growth en Ridgeline AI", o nada si ya no está. */
function about(opportunityId: string, copy: RepCopy): string {
  const opportunity = getOpportunity(opportunityId)
  return opportunity ? copy.bot.about(opportunity.role, opportunity.company) : ''
}

/**
 * A yes or a no, against the one thing it can be about.
 *
 * A quoted message says which one and settles it. Without one, and with two
 * interruptions waiting, there is no way to tell which a bare yes belongs to
 * — and guessing would record a decision about a job they were not thinking
 * of. So it says so, and asks them to reply to the one they mean.
 */
function respondToInterruption(
  candidateId: string,
  response: CandidateResponse,
  quoted: NotificationRow | null,
  copy: RepCopy,
): HandledMessage {
  const pending = listPendingInterruptions(candidateId)

  const quotedId =
    quoted?.about_type === 'opportunity' &&
    pending.some((item) => item.opportunity.id === quoted.about_id)
      ? quoted.about_id
      : null

  if (!quotedId) {
    if (pending.length === 0) {
      return {
        outcome: 'nothing_pending',
        about: null,
        reply: copy.bot.nothingToYesNo,
      }
    }

    if (pending.length > 1) {
      return {
        outcome: 'ambiguous',
        about: null,
        detail: `${pending.length} interruptions waiting`,
        reply: copy.bot.severalWaiting(pending.length, baseUrl()).join('\n'),
      }
    }
  }

  const opportunityId = quotedId ?? pending[0].opportunity.id
  const result = recordCandidateResponse(opportunityId, response)
  if (!result.ok) {
    return {
      outcome: 'failed',
      about: { type: 'opportunity', id: opportunityId },
      detail: result.error,
      reply: copy.bot.couldNotWrite(result.error),
    }
  }

  return {
    outcome: 'recorded_response',
    about: { type: 'opportunity', id: opportunityId },
    // Again, what the screen says. The medium changed, not the Rep.
    reply: (response === 'HEAR_THEM_OUT'
      ? copy.bot.heardThemOut(about(opportunityId, copy))
      : copy.bot.notForMe(about(opportunityId, copy))
    ).join('\n'),
  }
}

// ─── Going and getting it ─────────────────────────────────────────────────

export interface PollResult {
  fetched: number
  handled: number
  /** Handed over again after a restart, and already dealt with. */
  repeated: number
  /** From a chat that is not theirs. */
  foreign: number
}

/**
 * One pass: ask what has arrived, act on it, answer.
 *
 * The order inside the loop is deliberate. The message is claimed in the
 * database before anything is done about it, so an update handed over twice
 * finds itself already there and stops. Then it is handled. Only then is the
 * reply sent — and a reply that fails to send does not undo the answer,
 * because the answer is the part that matters and "noted" is a courtesy.
 */
export async function pollTelegram(candidateId: string): Promise<PollResult> {
  const result: PollResult = { fetched: 0, handled: 0, repeated: 0, foreign: 0 }

  const config = getTelegramConfig()
  if (!config) return result

  // Their chat, and only their chat. A bot's username is public and anybody
  // can write to it; nothing a stranger sends is going to touch this graph.
  const chatId = readPreferences(candidateId).notifyTelegram?.trim()
  if (!chatId) return result

  const last = lastInboundExternalId('telegram')
  const messages = await fetchUpdates(config, last === null ? null : last + 1)
  result.fetched = messages.length

  for (const message of messages) {
    const outcome = await handleOne(candidateId, chatId, message, config)
    if (outcome === 'foreign') result.foreign += 1
    else if (outcome === 'repeated') result.repeated += 1
    else result.handled += 1
  }

  return result
}

/** Contestar no puede tumbar el paso: lo importante ya está guardado. */
async function say(
  config: TelegramConfig,
  chatId: string,
  text: string,
): Promise<void> {
  try {
    await sendTelegramMessage(config, chatId, text)
  } catch {
    // El motivo queda en la fila; un acuse perdido no se reintenta.
  }
}

async function handleOne(
  candidateId: string,
  chatId: string,
  message: InboundTelegramMessage,
  config: TelegramConfig,
): Promise<'handled' | 'repeated' | 'foreign'> {
  const foreign = message.chatId !== chatId

  // Written down either way, the stranger's included: the row is what moves
  // the cursor past it, and a message that vanished without trace would make
  // "I replied and nothing happened" impossible to answer afterwards.
  const claim = claimInboundMessage({
    candidate_id: candidateId,
    channel: 'telegram',
    external_id: String(message.updateId),
    chat_id: message.chatId,
    sender: message.sender || null,
    text: message.text,
    outcome: foreign ? 'ignored' : 'failed',
  })
  if (!claim.created) return 'repeated'

  if (foreign) {
    // Nothing is said back to a chat we do not know. Explaining what this is
    // would be a conversation, and there is nobody here to have one.
    settleInboundMessage(claim.message.id, 'ignored', null, 'not the configured chat')
    return 'foreign'
  }

  // Una nota de voz es una respuesta, y contestar tres cosas hablando es
  // medio minuto contra cinco escribiendo. Del audio no se guarda nada: lo
  // que queda es la transcripción, en la misma fila.
  let text = message.text
  if (text.trim().length === 0 && message.voiceFileId) {
    const copy = copyIn(readPreferences(candidateId).language)
    try {
      const { blob, filename } = await fetchVoice(config, message.voiceFileId)
      text = await transcribeAudio(blob, filename)
      recordInboundTranscript(claim.message.id, text)
    } catch (error) {
      const reason =
        error instanceof TranscriptionError || error instanceof Error
          ? error.message
          : 'no salió'
      settleInboundMessage(claim.message.id, 'failed', null, reason)
      await say(config, chatId, copy.bot.voiceProblem(reason))
      return 'handled'
    }
  }

  let handled: HandledMessage
  try {
    handled = handleMessage(candidateId, text, message.replyToMessageId)
  } catch (error) {
    // The claim already says `failed`, so what they wrote is kept and the
    // reason sits next to it. One message nobody can read does not end the
    // pass, and it must not be tried again either: it would fail again.
    settleInboundMessage(
      claim.message.id,
      'failed',
      null,
      error instanceof Error ? error.message : 'could not be handled',
    )
    return 'handled'
  }

  settleInboundMessage(claim.message.id, handled.outcome, handled.about, handled.detail ?? null)

  // Todo lo que llegue de él es contexto del perfil. Va a la cola y no aquí
  // porque extraer cuesta una llamada al modelo, y el sondeo de Telegram
  // tiene carril propio para que contestar en el móvil se note en segundos:
  // esperar a una extracción dentro del sondeo es volver a atarlo todo a que
  // alguien esté mirando.
  if (handled.asContext && text.trim().length > 0) {
    enqueue('incorporate_unprompted', candidateId, { messageId: claim.message.id })
  }

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: handled.about?.type ?? 'inbound',
    subject_id: handled.about?.id ?? claim.message.id,
    event: 'inbound_message',
    detail: {
      channel: 'telegram',
      outcome: handled.outcome,
      chars: text.length,
      spoken: Boolean(message.voiceFileId),
    },
  })

  if (handled.reply) {
    try {
      // Si vino hablando, se le enseña lo que se ha entendido: una
      // transcripción mala que entra al grafo sin que nadie la vea es peor
      // que no entender nada.
      const spoken = message.voiceFileId && text.trim().length > 0
      const copy = copyIn(readPreferences(candidateId).language)
      await sendTelegramMessage(
        config,
        chatId,
        spoken ? `${copy.bot.heard(text)}\n\n${handled.reply}` : handled.reply,
      )
    } catch (error) {
      // The answer is in. Failing to say "noted" is not a reason to throw: a
      // retry would re-read updates that are already confirmed, so the work
      // would not happen twice — only the acknowledgement would be lost
      // twice, and this way the reason is written where it can be read.
      settleInboundMessage(
        claim.message.id,
        handled.outcome,
        handled.about,
        `handled, but the reply did not go out: ${
          error instanceof Error ? error.message : 'no answer'
        }`,
      )
    }
  }

  return 'handled'
}

/**
 * The queue's side, and its own next appointment.
 *
 * The same arrangement as the source sync: the job that runs is the job that
 * schedules the next one, in a `finally`, so a pass that fails against a
 * network that happens to be down does not quietly stop listening for good.
 *
 * A failed pass is not retried, and that is deliberate. The queue's backoff
 * exists for work that happens once and has to happen; this happens every
 * ten seconds anyway, so a retry would only pile failing jobs up during an
 * outage — and their errors are the ones the listening screen shows, which
 * would turn "the wifi dropped" into something the person has to read.
 *
 * Silently is not the same as invisibly. The reason is written down once,
 * and again only when it changes: a wrong token says the same thing every
 * ten seconds and one row is enough to find out about it.
 */
export async function pollTelegramJob(candidateId: string): Promise<void> {
  try {
    await pollTelegram(candidateId)
  } catch (error) {
    noteFailure(candidateId, error instanceof Error ? error.message : 'Telegram did not answer.')
  } finally {
    ensureInboundPolling(candidateId)
  }
}

function noteFailure(candidateId: string, message: string): void {
  const previous = listAuditEvents('channel', 'telegram').filter(
    (event) => event.event === 'inbound_poll_failed',
  )
  const last = previous[previous.length - 1]
  if (last && last.detail && JSON.parse(last.detail).error === message) return

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'channel',
    subject_id: 'telegram',
    event: 'inbound_poll_failed',
    detail: { error: message },
  })
}

/**
 * Make sure somebody is listening, and only one somebody.
 *
 * Also called from the endpoints the screens poll, so that typing the chat
 * id on the listening screen starts the loop without a restart, and so that
 * a laptop shut for three days picks it up again on the first request after
 * it comes back.
 */
export function ensureInboundPolling(candidateId: string): void {
  if (getTelegramConfig() === null) return
  if (!readPreferences(candidateId).notifyTelegram?.trim()) return
  if (hasQueuedKind(candidateId, 'poll_telegram')) return
  enqueue('poll_telegram', candidateId, {}, getTelegramPollIntervalMs())
}
