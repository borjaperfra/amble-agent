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
import type { CandidateResponse } from '@/domains/opportunity/types'
import {
  fetchUpdates,
  sendTelegramMessage,
  type InboundTelegramMessage,
} from '@/lib/notify/telegram'
import {
  claimInboundMessage,
  lastInboundExternalId,
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
  if (word === 'yes' || word === 'y') return { command: 'yes', text }
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
 * than a regular expression does. Only when nothing is open does a message
 * become something to acknowledge rather than act on.
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
  const quoted = replyToMessageId
    ? (findNotificationByExternalId('telegram', String(replyToMessageId)) ?? null)
    : null

  if (command === 'start' || command === 'help') {
    return { outcome: 'greeted', about: null, reply: GREETING }
  }

  if (command === 'yes' || command === 'no') {
    return respondToInterruption(
      candidateId,
      command === 'yes' ? 'HEAR_THEM_OUT' : 'NOT_FOR_ME',
      quoted,
    )
  }

  if (text.length === 0) {
    return {
      outcome: 'ignored',
      about: null,
      detail: 'nothing readable in the message',
      reply: 'That came through with nothing I can read. Text only, for now.',
    }
  }

  if (quoted) {
    const routed = answerQuoted(candidateId, quoted, text)
    if (routed) return routed
  }

  const open = listOpenQuestions(candidateId)
  if (open.length > 0) return answerOne(open[0], text, open.length > 1)

  const pending = listPendingInterruptions(candidateId)
  if (pending.length === 1) {
    const { opportunity } = pending[0]
    return {
      outcome: 'ambiguous',
      about: { type: 'opportunity', id: opportunity.id },
      detail: 'words arrived while an interruption was waiting for a yes or a no',
      reply: [
        `${opportunity.role} at ${opportunity.company} is still waiting on you.`,
        '',
        "Reply /yes and I'll write down that you want to hear them out, /no and it's gone.",
      ].join('\n'),
    }
  }

  return {
    outcome: 'nothing_pending',
    about: null,
    reply: [
      "Nothing is open right now, so I've written that down and left it there.",
      '',
      "When I need something from you I'll ask here, and whatever you send back is the answer.",
    ].join('\n'),
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
): HandledMessage | null {
  if (quoted.about_type === 'question') {
    const question = getQuestion(quoted.about_id)
    if (!question) return null
    if (question.status === 'open') return answerOne(question, text, false)

    // The one that actually happened: four messages arrive at once, three of
    // them about questions answered hours earlier on the screen, and nothing
    // on the phone says so. Naming it and saying it is closed is the least
    // this owes somebody who sat and answered it a second time.
    return {
      outcome: 'already_settled',
      about: { type: 'question', id: question.id },
      detail: 'a reply to a question that was already answered',
      reply: [
        `You had already answered that one${about(question.opportunity_id)}, so it is closed.`,
        '',
        "I've kept what you just wrote, but on its own it doesn't change anything.",
      ].join('\n'),
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
        reply: [
          `That one${about(quoted.about_id)} needs a yes or a no from you.`,
          '',
          "Reply /yes and I'll write down that you want to hear them out, /no and it's gone.",
        ].join('\n'),
      }
    }
    return {
      outcome: 'already_settled',
      about: { type: 'opportunity', id: quoted.about_id },
      detail: 'a reply to an interruption that was already answered',
      reply: `You already told me what you thought of that one${about(quoted.about_id)}.`,
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
): HandledMessage {
  const result = answerQuestion(question.id, text)
  if (!result.ok) {
    return {
      outcome: 'failed',
      about: { type: 'question', id: question.id },
      detail: result.error,
      reply: `I could not write that down: ${result.error}`,
    }
  }

  const lines = [
    `Thank you. Noted${about(question.opportunity_id)}.`,
    '',
    // Word for word what the screen says once an answer is in. The same
    // moment told two ways in two places is two products.
    "I'm working it into what I know about you. If it changes what I think of that role,",
    "you'll hear from me; if it doesn't, you won't.",
  ]
  if (othersOpen) {
    lines.push(
      '',
      'There is more than one thing open. If you meant one of the others, reply to its',
      "message and I'll put it there.",
    )
  }

  return {
    outcome: 'answered_question',
    about: { type: 'question', id: question.id },
    reply: lines.join('\n'),
  }
}

/** " — Head of Growth at Ridgeline AI", or nothing if it has gone. */
function about(opportunityId: string): string {
  const opportunity = getOpportunity(opportunityId)
  return opportunity ? ` — ${opportunity.role} at ${opportunity.company}` : ''
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
        reply: "There's nothing waiting for a yes or a no. I'll tell you when there is.",
      }
    }

    if (pending.length > 1) {
      return {
        outcome: 'ambiguous',
        about: null,
        detail: `${pending.length} interruptions waiting`,
        reply: [
          `There are ${pending.length} waiting, so I don't know which one you mean.`,
          '',
          "Reply to the one you mean and I'll take it from there, or they are all on the",
          `screen: ${baseUrl()}/listening`,
        ].join('\n'),
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
      reply: `I could not write that down: ${result.error}`,
    }
  }

  return {
    outcome: 'recorded_response',
    about: { type: 'opportunity', id: opportunityId },
    // Again, what the screen says. The medium changed, not the Rep.
    reply:
      response === 'HEAR_THEM_OUT'
        ? [
            `Good. I've written that down${about(opportunityId)}.`,
            '',
            "Nothing has gone to them. I can't talk to a company on your behalf yet — when I can,",
            'this is where it starts.',
          ].join('\n')
        : [
            `Fine. That one's gone${about(opportunityId)}.`,
            '',
            "I haven't changed what I'm listening for. A no is about that job, not about the shape",
            'of what you want.',
          ].join('\n'),
  }
}

const GREETING = [
  "I'm your Rep.",
  '',
  'I read what comes past and hold it against what you told me you want. Almost none of it',
  'reaches you — that is the deal. When something does, you get one message here: what the',
  'role is, what it pays, and the specific thing about you that made it worth your evening.',
  '',
  "Reply /yes and I'll write down that you want to hear them out, /no and it's gone.",
  '',
  'And if I need one thing before I can tell you, I will ask. Reply to that message and',
  'whatever you write is the answer — you never have to open anything.',
].join('\n')

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

  let handled: HandledMessage
  try {
    handled = handleMessage(candidateId, message.text, message.replyToMessageId)
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
  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: handled.about?.type ?? 'inbound',
    subject_id: handled.about?.id ?? claim.message.id,
    event: 'inbound_message',
    detail: { channel: 'telegram', outcome: handled.outcome, chars: message.text.length },
  })

  if (handled.reply) {
    try {
      await sendTelegramMessage(config, chatId, handled.reply)
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
