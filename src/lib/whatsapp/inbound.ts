import { getDb } from '../db/db'
import { getCandidate, now } from '../db/repo'
import { emailOwnerAbout, recordFeedback } from '../feedback'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { answerMessage } from './agent'
import { logMessage } from './conversation'
import { answerFollowup, parseFollowupPayload } from './followups'
import { linkBySender, saveLink, takeLinkCode, touchLink } from './link'
import { appUrl, handleAwaitedText, handleOfferTap, parseOfferPayload, sendDueOffers } from './offers'
import { answerPreference, isPreferencePayload, proposePreference } from './preferences'
import { sendMessage, zernioConfig } from './zernio'

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
  const reply = async (body: string, buttons?: { title: string; payload: string }[]) => {
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

  if (!text) {
    // A voice note, a picture: not read yet.
    if ((message.attachments?.length ?? 0) > 0) await reply(w.textOnly)
    return
  }

  if (await handleAwaitedText(candidate.id, text, reply)) {
    logMessage(candidate.id, 'in', text)
    return
  }

  // The agent reads the conversation so far, then this message joins it.
  const answer = await answerMessage(candidate.id, text).catch(() => null)
  logMessage(candidate.id, 'in', text)
  if (!answer) {
    await reply(w.agentFailed)
    return
  }
  const buttons = answer.intent === 'preferences' && answer.preference ? proposePreference(candidate.id, answer.preference) : undefined
  await reply(answer.reply, buttons)
  if (answer.forward || answer.intent === 'amble') {
    const row = recordFeedback(candidate, { message: text, page: null, channel: 'whatsapp' })
    await emailOwnerAbout(candidate, row)
  }
}
