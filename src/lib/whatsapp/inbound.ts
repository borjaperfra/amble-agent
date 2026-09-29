import { getDb } from '../db/db'
import { getCandidate, now } from '../db/repo'
import { emailOwnerAbout, recordFeedback } from '../feedback'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { answerFollowup, parseFollowupPayload } from './followups'
import { linkBySender, saveLink, takeLinkCode, touchLink } from './link'
import { sendMessage, zernioConfig } from './zernio'

// One event from the provider's webhook. Each is handled once (they retry
// until answered, with the same id). What someone writes is one of three
// things: the code that links their number, a tap on a follow-up button, or
// words, which reach the owner as feedback: in the beta, a person is behind
// every message.

interface InboundEvent {
  id: string
  event: string
  message?: {
    conversationId: string
    platform: string
    direction: string
    text: string | null
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
  const reply = (body: string, buttons?: { title: string; payload: string }[]) =>
    sendMessage(config, { conversationId: message.conversationId, text: body, buttons, idempotencyKey: `reply:${event.id}` })

  const linkingCandidate = text ? takeLinkCode(text) : null
  if (linkingCandidate) {
    saveLink(linkingCandidate, { phone, userId, conversationId: message.conversationId })
    const candidate = getCandidate(linkingCandidate)
    await reply(dictionaries[candidateLocale(candidate ?? null)].whatsapp.linked(candidate?.name ?? null))
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
  const w = dictionaries[candidateLocale(candidate)].whatsapp

  const tapped = parseFollowupPayload(event.metadata?.interactiveId ?? null)
  if (tapped) {
    const thanks = answerFollowup(candidate.id, tapped)
    if (thanks) await reply(thanks)
    return
  }

  if (text) {
    const row = recordFeedback(candidate, { message: text, page: null, channel: 'whatsapp' })
    await Promise.all([emailOwnerAbout(candidate, row), reply(w.noted)])
  }
}
