import { getDb } from '../db/db'
import { sendPhoto, sendText, telegramConfig } from '../telegram/api'
import { telegramLinkOf } from '../telegram/link'
import { linkOf, windowOpen } from '../whatsapp/link'
import { sendTemplate, type TemplateKind } from '../whatsapp/templates'
import { sendMessage, sendPicture, zernioConfig, type Button } from '../whatsapp/zernio'

// Where amble writes to someone first: WhatsApp or Telegram (#18), and what
// that channel allows now. Everything that writes on its own (offers,
// questions, reminders, follow-ups, the pause) goes through here, never to a
// provider directly. Someone with both connected is written to where they
// last wrote.

export type ChannelKind = 'whatsapp' | 'telegram'

export interface Outgoing {
  text: string
  buttons?: Button[]
  // WhatsApp only: past the 24 hours, sent as a utility message (Direct Send).
  utility?: boolean
  // WhatsApp only: the provider keeps it from going twice.
  idempotencyKey?: string
  // Telegram only: what can wait (a question for their map, a follow-up,
  // what was added) arrives without a sound. At night everything does.
  quiet?: boolean
  // Telegram only: an offer's card, kept by its message so a reaction to it
  // answers it (telegram_cards).
  card?: { matchId: string; url: string | null }
}

export interface Reach {
  candidateId: string
  kind: ChannelKind
  // Free to write now: WhatsApp within 24 hours of their last message;
  // Telegram always.
  open: boolean
  // WhatsApp's shared test number: no templates of ours there.
  sandbox: boolean
  send(message: Outgoing): Promise<void>
  sendPicture(params: { image: Buffer; filename: string; text: string; buttons?: Button[]; idempotencyKey?: string; quiet?: boolean }): Promise<void>
  // WhatsApp only, past the 24 hours: the approved template that asks first.
  template(kind: TemplateKind, values: string[], payloads: (string | null)[], idempotencyKey: string): Promise<void>
}

// From 22:00 to 08:00 in Madrid, where amble's people are.
const QUIET_FROM_HOUR = 22
const QUIET_UNTIL_HOUR = 8

function night(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(date))
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR
}

export function reachOf(candidateId: string): Reach | null {
  const zernio = zernioConfig()
  const whatsapp = zernio ? linkOf(candidateId) : null
  const telegram = telegramConfig()
  const chat = telegram ? telegramLinkOf(candidateId) : null
  const onWhatsApp = Boolean(whatsapp?.conversation_id)
  if (chat && telegram && (!onWhatsApp || (chat.last_inbound_at ?? chat.linked_at) >= (whatsapp?.last_inbound_at ?? whatsapp?.linked_at ?? ''))) {
    return {
      candidateId,
      kind: 'telegram',
      open: true,
      sandbox: false,
      send: async (message) => {
        const sent = await sendText(telegram, chat.chat_id, message.text, message.buttons, { quiet: message.quiet || night() })
        if (message.card && sent.messageId !== null) {
          getDb()
            .prepare(
              'INSERT OR REPLACE INTO telegram_cards (chat_id, message_id, candidate_id, match_id, body, url, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(chat.chat_id, sent.messageId, candidateId, message.card.matchId, message.text, message.card.url, new Date().toISOString())
        }
      },
      sendPicture: (params) => sendPhoto(telegram, chat.chat_id, { ...params, quiet: params.quiet || night() }),
      template: async () => {
        throw new Error('Telegram has no templates')
      },
    }
  }
  if (!zernio || !whatsapp?.conversation_id) return null
  const conversationId = whatsapp.conversation_id
  return {
    candidateId,
    kind: 'whatsapp',
    open: windowOpen(whatsapp),
    sandbox: zernio.sandbox,
    send: async (message) => {
      await sendMessage(zernio, { conversationId, ...message })
    },
    sendPicture: async (params) => {
      await sendPicture(zernio, { conversationId, ...params })
    },
    template: (kind, values, payloads, idempotencyKey) => sendTemplate(zernio, whatsapp, kind, values, payloads, idempotencyKey),
  }
}

// Everyone amble can write to on some channel.
export function reachableCandidateIds(): string[] {
  const db = getDb()
  const ids = new Set<string>()
  if (zernioConfig()) {
    for (const row of db.prepare('SELECT candidate_id FROM whatsapp_links WHERE conversation_id IS NOT NULL').all() as { candidate_id: string }[]) ids.add(row.candidate_id)
  }
  if (telegramConfig()) {
    for (const row of db.prepare('SELECT candidate_id FROM telegram_links').all() as { candidate_id: string }[]) ids.add(row.candidate_id)
  }
  return [...ids]
}

// Connected anywhere: what the screens ask before offering to connect.
export function isReachable(candidateId: string): boolean {
  return reachOf(candidateId) !== null
}

// For the screens: whether amble has a chat to offer (WhatsApp or Telegram),
// and whether they connected one.
export function chatAvailability(candidateId: string): { available: boolean; linked: boolean } {
  return {
    available: zernioConfig() !== null || telegramConfig() !== null,
    linked: (zernioConfig() !== null && linkOf(candidateId) !== null) || (telegramConfig() !== null && telegramLinkOf(candidateId) !== null),
  }
}
