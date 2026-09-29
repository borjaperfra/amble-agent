import { getDb } from '../db/db'
import { getCandidate, now, type CandidateRow } from '../db/repo'
import { emailOwnerAbout, recordFeedback } from '../feedback'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { transcribe } from '../model/transcribe'
import { runAction } from './actions'
import { leaveReminder } from './reminders'
import { answerMessage } from './agent'
import { logMessage } from './conversation'
import { answerFollowup, parseFollowupPayload } from './followups'
import { linkBySender, saveLink, takeLinkCode, touchLink } from './link'
import { appUrl, handleAwaitedText, handleOfferTap, parseOfferPayload, sendDueOffers } from './offers'
import { answerPreference, isPreferencePayload, proposePreference } from './preferences'
import { markRead, react, sendMessage, showTyping, zernioConfig, type ZernioConfig } from './zernio'

// One event from the provider's webhook. Each is handled once (they retry
// until answered, with the same id). What someone writes is, in order: the
// code that links their number; a tap on a button (an offer, a question
// about an application, a proposed change); the reason after a "doesn't
// fit"; or words, which the agent answers. What is about amble itself also
// reaches the owner. Everything said, both ways, is kept.

interface InboundEvent {
  id: string
  event: string
  message?: {
    conversationId: string
    platform: string
    direction: string
    text: string | null
    platformMessageId?: string
    attachments?: unknown[]
    sender: { id: string; phoneNumber?: string | null; businessScopedUserId?: string }
  }
  metadata?: { interactiveId?: string } | null
}

export async function handleEvent(event: InboundEvent): Promise<void> {
  const db = getDb()
  const seen = db.prepare('INSERT OR IGNORE INTO whatsapp_events (id, event, received_at) VALUES (?, ?, ?)').run(event.id, event.event, now())
  if (seen.changes === 0) return
  if (event.event !== 'message.received') return
  const message = event.message
  if (!message || message.platform !== 'whatsapp' || message.direction !== 'incoming') return
  const config = zernioConfig()
  if (!config) return

  // WhatsApp's own id for the person, when it comes; the number otherwise.
  const phone = (message.sender.phoneNumber ?? `+${message.sender.id}`).replace(/[^\d+]/g, '')
  const userId = message.sender.businessScopedUserId ?? null
  const text = (message.text ?? '').trim()
  const interactiveId = event.metadata?.interactiveId ?? null

  // Each reply its own key: one event can be answered in several messages.
  let replies = 0
  let replyTo: string | null = null
  const reply: Reply = async (body, buttons) => {
    await sendMessage(config, { conversationId: message.conversationId, text: body, buttons, idempotencyKey: `reply:${event.id}:${replies++}` })
    if (replyTo) logMessage(replyTo, 'out', body)
  }

  const linkingCandidate = text ? takeLinkCode(text) : null
  if (linkingCandidate) {
    saveLink(linkingCandidate, { phone, userId, conversationId: message.conversationId })
    replyTo = linkingCandidate
    const candidate = getCandidate(linkingCandidate)
    await reply(dictionaries[candidateLocale(candidate ?? null)].whatsapp.linked(candidate?.name ?? null))
    // What it has already found, now that it can say so.
    await sendDueOffers(linkingCandidate)
    return
  }

  const link = linkBySender({ userId, phone })
  if (!link) {
    // Someone amble does not know: where to start, and nothing more.
    await reply(`${dictionaries.es.whatsapp.unknown}\n\n${dictionaries.en.whatsapp.unknown}`)
    return
  }
  touchLink(link.candidate_id, message.conversationId)
  // Seen, at once: the blue ticks.
  void markRead(config, message.conversationId).catch(() => undefined)
  const candidate = getCandidate(link.candidate_id)
  if (!candidate) return
  replyTo = candidate.id
  const w = dictionaries[candidateLocale(candidate)].whatsapp

  const offerTap = parseOfferPayload(interactiveId)
  if (offerTap) {
    logMessage(candidate.id, 'in', text)
    await handleOfferTap(candidate.id, offerTap, reply)
    return
  }
  const followupTap = parseFollowupPayload(interactiveId)
  if (followupTap) {
    logMessage(candidate.id, 'in', text)
    const thanks = answerFollowup(candidate.id, followupTap)
    if (thanks) await reply(thanks)
    return
  }
  if (isPreferencePayload(interactiveId)) {
    logMessage(candidate.id, 'in', text)
    await answerPreference(candidate.id, interactiveId, reply, appUrl)
    return
  }

  // A voice note is heard as what it says; a picture is not read yet.
  if (!text) {
    const voice = (message.attachments as { type?: string; url?: string; mimeType?: string }[] | undefined)?.find((item) => item.type === 'audio' && item.url)
    if (voice?.url) {
      const heard = await hear(config.apiKey, voice.url, voice.mimeType ?? 'audio/ogg', candidateLocale(candidate)).catch(() => '')
      if (heard) return answerWords(candidate, heard, reply, w, { config, conversationId: message.conversationId, messageId: message.platformMessageId ?? null })
      await reply(w.voiceFailed)
      return
    }
    if ((message.attachments?.length ?? 0) > 0) await reply(w.textOnly)
    return
  }

  return answerWords(candidate, text, reply, w, { config, conversationId: message.conversationId, messageId: message.platformMessageId ?? null })
}

type Reply = (body: string, buttons?: { title: string; payload: string }[]) => Promise<void>

// Words, typed or spoken: the reason awaited after a "doesn't fit", or else
// the agent's to answer.
// While the agent thinks: "typing…" on their screen, renewed as it lasts
// (WhatsApp shows it for 25 seconds), and after a few seconds a short line
// saying the answer is on its way.
const HOLD_AFTER_MS = 12_000
const TYPING_EVERY_MS = 20_000

async function answerWords(
  candidate: CandidateRow,
  text: string,
  reply: Reply,
  w: (typeof dictionaries)['es']['whatsapp'],
  chat: { config: ZernioConfig; conversationId: string; messageId: string | null },
): Promise<void> {
  if (await handleAwaitedText(candidate.id, text, reply)) {
    logMessage(candidate.id, 'in', text)
    return
  }

  const typing = () => void showTyping(chat.config, chat.conversationId).catch(() => undefined)
  typing()
  const typingTimer = setInterval(typing, TYPING_EVERY_MS)
  // The line saying it is on its way goes only if the answer is slow, and
  // always before the answer, never after it.
  let holding: Promise<unknown> | null = null
  const holdTimer = setTimeout(() => {
    holding = reply(w.thinking).catch(() => undefined)
  }, HOLD_AFTER_MS)
  // The agent reads the conversation so far, then this message joins it.
  const answer = await answerMessage(candidate.id, text).catch(() => null)
  clearTimeout(holdTimer)
  clearInterval(typingTimer)
  if (holding) await holding
  logMessage(candidate.id, 'in', text)
  if (answer?.reaction && chat.messageId) void react(chat.config, chat.conversationId, chat.messageId, answer.reaction).catch(() => undefined)
  if (!answer) {
    await reply(w.agentFailed)
    return
  }
  let buttons = answer.intent === 'preferences' && answer.preference ? proposePreference(candidate.id, answer.preference) : undefined
  // What it decided to do: prepare an application (offered with buttons),
  // or keep the news they gave about one.
  if (answer.action) {
    const done = runAction(candidate.id, answer.action, w.applyButtons)
    if (done.buttons) buttons = done.buttons
  }
  await reply(answer.reply, buttons)
  if (answer.remind) leaveReminder(candidate.id, answer.remind.date, answer.remind.message)
  // Only what the agent marks for the team: a problem or a suggestion.
  if (answer.forward) {
    const row = recordFeedback(candidate, { message: text, page: null, channel: 'whatsapp' })
    await emailOwnerAbout(candidate, row)
  }
}

// A voice note: fetched from the provider (it needs our key, and WhatsApp
// drops media after a while, so now) and transcribed. The audio is not kept.
async function hear(apiKey: string, url: string, mimeType: string, language: string): Promise<string> {
  // Our key goes only to Zernio's own media endpoint, never to another host.
  const own = new URL(url).hostname === 'zernio.com'
  const response = await fetch(url, { headers: own ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) return ''
  const audio = new Blob([await response.arrayBuffer()], { type: mimeType })
  return transcribe(audio, mimeType.includes('mp4') ? 'note.m4a' : 'note.ogg', language)
}
