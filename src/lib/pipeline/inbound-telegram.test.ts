/**
 * The way back, against a stubbed Telegram and a throwaway database.
 *
 * Three things are worth pinning down, and all three are about a message
 * arriving more than once or from somewhere it should not.
 *
 * Telegram hands an update over again until an offset confirms it, so the
 * same answer can turn up after a restart — and an answer worked into the
 * graph twice is two sets of evidence saying the same thing, from one
 * sentence somebody typed once. The bot's username is public, so anybody
 * can write to it, and nothing a stranger sends may touch this graph. And a
 * command has to stay a command without swallowing the words around it: a
 * question is open far more often than an interruption is waiting, and
 * "yes, for two years" is an answer, not a verdict on some other job.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

type Inbound = typeof import('./inbound-telegram')
type Opportunities = typeof import('../db/opportunities')
type Repo = typeof import('../db/repo')
type Preferences = typeof import('./preferences')
type InboundDb = typeof import('../db/inbound')

const CHAT = '4242'
const STRANGER = '9999'

let inbound: Inbound
let opportunities: Opportunities
let repo: Repo
let preferences: Preferences
let inboundDb: InboundDb
let candidateId: string
let opportunityId: string
let workingDirectory: string
let previousDirectory: string

/** Everything the stub was asked for, in order. */
let calls: { url: string; body: unknown }[] = []
/** What the next `getUpdates` hands back. */
let updates: unknown[] = []

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-inbound-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'
  process.env.AMBLE_TELEGRAM_BOT_TOKEN = '123456:SECRET-TOKEN-DO-NOT-LEAK'

  inbound = await import('./inbound-telegram')
  opportunities = await import('../db/opportunities')
  repo = await import('../db/repo')
  preferences = await import('./preferences')
  inboundDb = await import('../db/inbound')

  candidateId = repo.getOrCreateCandidate().id
  preferences.writePreferences(candidateId, {
    notifyChannels: ['telegram'],
    notifyTelegram: CHAT,
  })

  opportunityId = opportunities.insertOpportunity({
    candidate_id: candidateId,
    company: 'Solenne',
    role: 'Head of Growth',
    url: null,
    raw_text: 'Solenne is looking for a Head of Growth for its developer platform.',
    provenance: 'test',
  }).id

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const target = String(url)
    calls.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : null })
    const payload = target.includes('/getUpdates')
      ? { ok: true, result: updates }
      : { ok: true, result: { message_id: calls.length } }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
})

after(() => {
  process.chdir(previousDirectory)
  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open a moment longer than we care about.
  }
})

beforeEach(() => {
  calls = []
  updates = []
})

/** One text message, as Telegram hands it over. */
function update(id: number, text: string, chatId = CHAT) {
  return {
    update_id: id,
    message: { chat: { id: Number(chatId), first_name: 'Borja' }, text },
  }
}

/** The same, but as a reply to one of ours — what tapping "reply" produces. */
function replyTo(id: number, text: string, messageId: number) {
  return {
    update_id: id,
    message: {
      chat: { id: Number(CHAT), first_name: 'Borja' },
      text,
      reply_to_message: { message_id: messageId },
    },
  }
}

function sent() {
  return calls.filter((call) => call.url.includes('/sendMessage'))
}

describe('classifyMessage', () => {
  it('reads a command, with or without the bot name on it', () => {
    assert.equal(inbound.classifyMessage('/yes').command, 'yes')
    assert.equal(inbound.classifyMessage('  /No@amble_rep_bot ').command, 'no')
    assert.equal(inbound.classifyMessage('/start').command, 'start')
  })

  it('leaves words alone, including words that start with one', () => {
    // The one that matters: an answer whose first word is yes.
    assert.equal(inbound.classifyMessage('yes, for about two years').command, null)
    assert.equal(inbound.classifyMessage('/yes please').command, null)
    assert.equal(inbound.classifyMessage('no idea, honestly').command, null)
  })
})

describe('an answer arriving from the phone', () => {
  let questionId: string

  before(() => {
    questionId = opportunities.insertQuestion({
      candidate_id: candidateId,
      opportunity_id: opportunityId,
      decision_id: null,
      unknown_id: 'unk_dev_community',
      question: 'Have you built or run a developer community yourself?',
      reason: 'Solenne wants somebody who has run one.',
    }).question.id
  })

  it('takes the whole message as the answer and says so', async () => {
    updates = [update(10, 'Yes — I ran the Manfred community, 120k developers.')]

    const result = await inbound.pollTelegram(candidateId)
    assert.deepEqual(result, { fetched: 1, handled: 1, repeated: 0, foreign: 0 })

    const question = opportunities.getQuestion(questionId)
    assert.equal(question?.status, 'answered')
    assert.equal(question?.answer, 'Yes — I ran the Manfred community, 120k developers.')

    const reply = sent()[0]?.body as { chat_id: string; text: string }
    assert.equal(reply.chat_id, CHAT)
    // It names the role: on a phone there may be four of these in flight.
    assert.match(reply.text, /Apuntado — Head of Growth en Solenne\./)

    const row = inboundDb.findInboundMessage('telegram', '10')
    assert.equal(row?.outcome, 'answered_question')
    assert.equal(row?.about_id, questionId)
  })

  it('does not answer it twice when Telegram hands it over again', async () => {
    // Exactly what a restart between the reply and the next poll looks like.
    updates = [update(10, 'Yes — I ran the Manfred community, 120k developers.')]

    const result = await inbound.pollTelegram(candidateId)
    assert.deepEqual(result, { fetched: 1, handled: 0, repeated: 1, foreign: 0 })
    assert.equal(sent().length, 0, 'and it does not say thank you a second time')
    assert.equal(inboundDb.listInboundMessages(candidateId).length, 1)
  })

  it('asks Telegram to forget everything up to the last one written down', async () => {
    updates = []
    await inbound.pollTelegram(candidateId)
    const asked = calls.find((call) => call.url.includes('/getUpdates'))
    assert.match(String(asked?.url), /offset=11/)
  })
})

describe('a message from a chat that is not theirs', () => {
  it('is written down, left alone, and never answered', async () => {
    updates = [update(20, 'hello? is this a job thing?', STRANGER)]

    const result = await inbound.pollTelegram(candidateId)
    assert.deepEqual(result, { fetched: 1, handled: 0, repeated: 0, foreign: 1 })
    assert.equal(sent().length, 0, 'nothing is said back to somebody we do not know')

    const row = inboundDb.findInboundMessage('telegram', '20')
    assert.equal(row?.outcome, 'ignored')
    assert.equal(row?.detail, 'not the configured chat')
  })
})

describe('a message with nothing open', () => {
  it('is acknowledged rather than acted on', async () => {
    updates = [update(30, 'any news?')]

    await inbound.pollTelegram(candidateId)
    assert.equal(inboundDb.findInboundMessage('telegram', '30')?.outcome, 'nothing_pending')
    assert.match(String((sent()[0]?.body as { text: string }).text), /no hay nada abierto/)
  })

  it('answers /start with what this is, and eats nothing', async () => {
    updates = [update(31, '/start')]

    await inbound.pollTelegram(candidateId)
    assert.equal(inboundDb.findInboundMessage('telegram', '31')?.outcome, 'greeted')
    assert.match(String((sent()[0]?.body as { text: string }).text), /Soy tu Rep\./)
  })
})

describe('a yes or a no about an interruption', () => {
  before(() => {
    const rubric = opportunities.insertRubric({
      opportunity_id: opportunityId,
      version: 'test',
      rubric: '{}',
      model_run_id: null,
      latency_ms: null,
    })
    const assessment = opportunities.insertAssessment({
      opportunity_id: opportunityId,
      rubric_id: rubric.id,
      version: 'test',
      hard_constraints: '[]',
      evidence_match: '[]',
      intent_match: '[]',
      unknowns: '[]',
      intent_references: '[]',
      model_run_id: null,
      latency_ms: null,
    })
    opportunities.insertDecision({
      opportunity_id: opportunityId,
      assessment_id: assessment.id,
      version: 'test',
      model_decision: 'INTERRUPT',
      decision: 'INTERRUPT',
      override_reason: null,
      reason: 'It pays above the floor and the evidence is there.',
      supporting_evidence_ids: '[]',
      supporting_intent_refs: '[]',
      material_unknowns: '[]',
      next_action_type: 'ASK_CANDIDATE',
      next_action_question: null,
      explanation: null,
      unsupported_claims: '[]',
      model_run_id: null,
      explanation_model_run_id: null,
      latency_ms: null,
    })
  })

  it('records the no against the one thing it can be about', async () => {
    updates = [update(40, '/no')]

    await inbound.pollTelegram(candidateId)

    const response = opportunities.getResponse(opportunityId)
    assert.equal(response?.response, 'NOT_FOR_ME')

    const row = inboundDb.findInboundMessage('telegram', '40')
    assert.equal(row?.outcome, 'recorded_response')
    assert.equal(row?.about_id, opportunityId)
    assert.match(String((sent()[0]?.body as { text: string }).text), /Fuera — Head of Growth en Solenne/)
  })

  it('has nothing to say yes to once it has been answered', async () => {
    updates = [update(41, '/yes')]

    await inbound.pollTelegram(candidateId)
    assert.equal(inboundDb.findInboundMessage('telegram', '41')?.outcome, 'nothing_pending')
    assert.match(
      String((sent()[0]?.body as { text: string }).text),
      /No hay nada esperando un sí o un no/,
    )
  })
})

describe('with no chat set up', () => {
  it('does not go near Telegram at all', async () => {
    preferences.writePreferences(candidateId, { notifyTelegram: '' })
    updates = [update(50, 'hello')]

    const result = await inbound.pollTelegram(candidateId)

    assert.deepEqual(result, { fetched: 0, handled: 0, repeated: 0, foreign: 0 })
    // The point is not tidiness. Asking with an offset tells Telegram it can
    // forget those updates, and the chat id is found by messaging the bot
    // and reading them back: polling first would eat the setup message.
    assert.equal(calls.length, 0)

    preferences.writePreferences(candidateId, { notifyTelegram: CHAT })
  })
})

/**
 * Four messages went out at once on the first real run, three of them about
 * questions answered hours earlier on a screen. Everything below is that
 * morning, written down so it cannot happen twice.
 */
describe('several messages in flight at once', () => {
  let first: string
  let second: string
  let secondMessageId: string

  before(async () => {
    const notifications = await import('../db/notifications')

    first = opportunities.insertQuestion({
      candidate_id: candidateId,
      opportunity_id: opportunityId,
      decision_id: null,
      unknown_id: null,
      question: 'How do you earn credibility with developer audiences?',
      reason: 'Solenne sells to developers.',
    }).question.id

    second = opportunities.insertQuestion({
      candidate_id: candidateId,
      opportunity_id: opportunityId,
      decision_id: null,
      unknown_id: null,
      question: 'Have you marketed an inference platform before?',
      reason: 'The posting turns on it.',
    }).question.id

    // What the outbox looks like once that question has gone out: the row
    // knows which Telegram message it became.
    const notice = notifications.insertNotification({
      candidate_id: candidateId,
      channel: 'telegram',
      address: CHAT,
      subject: 'Your Rep needs one thing',
      body: 'Have you marketed an inference platform before?',
      about_type: 'question',
      about_id: second,
      status: 'sent',
    })
    secondMessageId = '900'
    notifications.setNotificationExternalId(notice.notification.id, secondMessageId)
  })

  it('answers the one they replied to, not the oldest one open', async () => {
    updates = [replyTo(60, 'Yes, at Helmcode right now.', Number(secondMessageId))]

    await inbound.pollTelegram(candidateId)

    assert.equal(opportunities.getQuestion(second)?.status, 'answered')
    assert.equal(
      opportunities.getQuestion(first)?.status,
      'open',
      'the older one is untouched: they said which they meant',
    )
  })

  it('says a question is closed instead of eating the answer', async () => {
    // The same message quoted again, now that it has been answered. Before
    // this, the reply was "nothing is open right now" — after somebody had
    // sat and answered it a second time.
    updates = [replyTo(61, 'Also the Manfred community.', Number(secondMessageId))]

    await inbound.pollTelegram(candidateId)

    const row = inboundDb.findInboundMessage('telegram', '61')
    assert.equal(row?.outcome, 'already_settled')
    assert.equal(row?.about_id, second)
    assert.match(
      String((sent()[0]?.body as { text: string }).text),
      /Esa ya la contestaste — Head of Growth en Solenne/,
    )
    assert.equal(
      opportunities.getQuestion(first)?.status,
      'open',
      'and the one that is genuinely open stays open',
    )
  })

  it('tells them how to pick when it had to guess', async () => {
    // Two open and no quote: it takes the oldest, which is a guess, and a
    // guess has to be said out loud or the answer lands somewhere they
    // cannot see.
    opportunities.insertQuestion({
      candidate_id: candidateId,
      opportunity_id: opportunityId,
      decision_id: null,
      unknown_id: null,
      question: 'Which of those did you run end to end?',
      reason: 'Two of them overlap.',
    })
    updates = [update(62, 'Mostly content and video.')]

    await inbound.pollTelegram(candidateId)

    assert.equal(opportunities.getQuestion(first)?.status, 'answered')
    assert.match(
      String((sent()[0]?.body as { text: string }).text),
      /más de una cosa abierta[\s\S]*responde a su mensaje/,
    )
  })
})

describe('el idioma se elige', () => {
  it('contesta en inglés cuando lo pide, sin cambiar nada más', async () => {
    preferences.writePreferences(candidateId, { language: 'en' })
    updates = [update(70, 'any news?')]

    try {
      await inbound.pollTelegram(candidateId)
      // Sigue habiendo una pregunta abierta del bloque anterior, así que lo
      // que prueba esto es el idioma, no la rama.
      assert.match(String((sent()[0]?.body as { text: string }).text), /Noted — Head of Growth at Solenne/)
    } finally {
      preferences.writePreferences(candidateId, { language: 'es' })
    }
  })

  it('vuelve al castellano igual de rápido', async () => {
    updates = [update(71, '¿alguna novedad?')]

    await inbound.pollTelegram(candidateId)
    assert.match(String((sent()[0]?.body as { text: string }).text), /Apuntado|no hay nada abierto/)
  })
})
