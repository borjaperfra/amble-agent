import { getDb } from '../db/db'
import { getCandidate, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { logMessage } from '../whatsapp/conversation'
import { handleFromPerson, type IncomingFile } from '../whatsapp/inbound'
import { sendDueOffers } from '../whatsapp/offers'
import { allow } from '../whatsapp/throttle'
import { answerTap, fetchFile, reactTo, sendText, sendTyping, telegramConfig } from './api'
import { saveTelegramLink, takeStartCode, telegramLinkByChat, touchTelegramLink } from './link'

// One update from Telegram's webhook, handled once (Telegram retries until
// answered, with the same update_id). As on WhatsApp: the start code that
// connects the chat; else whose chat it is, and what they wrote, tapped or
// sent, answered by the same core (handleFromPerson). Only private chats:
// amble is never in a group.

interface TelegramUser {
  id: number
  username?: string
}

interface TelegramFileRef {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramMessage {
  message_id: number
  chat: { id: number; type: string }
  from?: TelegramUser
  text?: string
  caption?: string
  document?: TelegramFileRef
  voice?: TelegramFileRef
  audio?: TelegramFileRef
  photo?: unknown[]
  video?: unknown
  sticker?: unknown
  reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] }
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: { id: string; from: TelegramUser; data?: string; message?: TelegramMessage }
}

// Where to start, said to a chat amble does not know: once in a while.
const STRANGER_REPLIES = 2
const STRANGER_WINDOW_MS = 6 * 60 * 60 * 1000

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (typeof update?.update_id !== 'number') return
  const config = telegramConfig()
  if (!config) return
  const tap = update.callback_query ?? null
  const message = update.message ?? tap?.message ?? null
  if (!message || message.chat?.type !== 'private') return
  const db = getDb()
  const seen = db.prepare('INSERT OR IGNORE INTO whatsapp_events (id, event, received_at) VALUES (?, ?, ?)').run(`tg:${update.update_id}`, tap ? 'telegram.tap' : 'telegram.message', now())
  if (seen.changes === 0) return

  const chatId = String(message.chat.id)
  const from = tap?.from ?? message.from ?? null
  // The spinner on the button stops at once.
  if (tap) void answerTap(config, tap.id).catch(() => undefined)
  // A tap reads as the button's words, as WhatsApp gives them.
  const tapped = tap?.data
    ? (message.reply_markup?.inline_keyboard ?? []).flat().find((button) => button.callback_data === tap.data)?.text ?? ''
    : ''
  const text = tap ? tapped : (message.text ?? message.caption ?? '').trim()

  let replyTo: string | null = null
  const reply = async (body: string, buttons?: { title: string; payload: string }[]) => {
    await sendText(config, chatId, body, buttons)
    if (replyTo) logMessage(replyTo, 'out', body)
  }

  // "/start <code>" from the app's link: the chat is theirs from now on.
  const linking = !tap && text ? takeStartCode(text) : null
  if (linking) {
    saveTelegramLink(linking, { chatId, userId: from ? String(from.id) : null, username: from?.username ?? null })
    replyTo = linking
    const candidate = getCandidate(linking)
    await reply(dictionaries[candidateLocale(candidate ?? null)].whatsapp.linked(candidate?.name ?? null))
    // What it has already found, now that it can say so.
    await sendDueOffers(linking)
    return
  }

  const link = telegramLinkByChat(chatId)
  if (!link) {
    if (allow('stranger-tg', chatId, STRANGER_REPLIES, STRANGER_WINDOW_MS)) {
      await reply(`${dictionaries.es.whatsapp.unknownTelegram}\n\n${dictionaries.en.whatsapp.unknownTelegram}`)
    }
    return
  }
  touchTelegramLink(link.candidate_id)
  const candidate = getCandidate(link.candidate_id)
  if (!candidate) return
  replyTo = candidate.id
  // "/start" again, from someone already connected: a greeting, not a question.
  if (/^\/start\b/.test(text)) {
    await reply(dictionaries[candidateLocale(candidate)].whatsapp.linked(candidate.name))
    return
  }

  const file = (ref: TelegramFileRef | undefined, fallback: string, mime: string | null): IncomingFile | null =>
    ref ? { name: (ref.file_name ?? fallback).slice(0, 120), mimeType: ref.mime_type ?? mime, fetch: (maxBytes) => fetchFile(config, ref.file_id, maxBytes) } : null
  return handleFromPerson(
    candidate,
    {
      text,
      interactiveId: tap?.data ?? null,
      buttonPayload: null,
      document: file(message.document, 'Telegram.pdf', null),
      voice: file(message.voice ?? message.audio, 'voice.ogg', 'audio/ogg'),
      otherAttachment: Boolean(message.photo || message.video || message.sticker),
    },
    {
      reply,
      typing: () => void sendTyping(config, chatId).catch(() => undefined),
      react: (emoji) => {
        if (!tap) void reactTo(config, chatId, message.message_id, emoji).catch(() => undefined)
      },
    },
  )
}
