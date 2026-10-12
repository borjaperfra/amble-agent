import { issueAppLink } from '../auth/applinks'
import { getDb } from '../db/db'
import { getCandidate, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { logMessage } from '../whatsapp/conversation'
import { handleFromPerson, type IncomingFile } from '../whatsapp/inbound'
import { sendDueOffers } from '../whatsapp/offers'
import { allow } from '../whatsapp/throttle'
import { answerTap, fetchFile, markAnswered, reactTo, replaceText, sendText, sendTyping, telegramConfig, type SentMessage } from './api'
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

// The «/» menu (#32). Some are answered here (a link, the list); the rest
// are what they would have written, and the agent answers them as such.
export const COMMANDS = ['ofertas', 'mapa', 'preferencias', 'pausa', 'ayuda'] as const
type Command = (typeof COMMANDS)[number]

// Where to start, said to a chat amble does not know: once in a while.
const STRANGER_REPLIES = 2
const STRANGER_WINDOW_MS = 6 * 60 * 60 * 1000

// The lines that say amble is on it (thinking, reading a link or a CV), in
// either language, and how long one waits to become its answer (#33).
const HOLDING_LINES = new Set(
  Object.values(dictionaries).flatMap((words) => [words.whatsapp.thinking, words.whatsapp.sharedReading, words.whatsapp.documentReading]),
)
const REPLACE_HOLDING_MS = 90_000

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
  // The card they tapped changes where it is (#33): what they chose below
  // it, and the first answer with it when that answer asks for no tap.
  let card = tap && tapped ? (message as SentMessage) : null
  // A line saying amble is on it becomes the answer it announced, when that
  // comes soon enough to be seen; later, the answer goes as a new message,
  // which their phone tells them about (an edit it does not).
  let holding: { messageId: number; at: number } | null = null
  const send = async (body: string, buttons?: { title: string; payload: string }[]) => {
    if (card) {
      const answered = card
      card = null
      const choice = `✓ ${tapped}`
      const folded = !buttons?.length && (await markAnswered(config, chatId, answered, `${choice}\n${plainWords(body)}`).catch(() => false))
      if (folded) return
      await markAnswered(config, chatId, answered, choice).catch(() => false)
    }
    const waiting = holding
    holding = null
    if (waiting && Date.now() - waiting.at < REPLACE_HOLDING_MS && (await replaceText(config, chatId, waiting.messageId, body, buttons).catch(() => false))) return
    const sent = await sendText(config, chatId, body, buttons)
    if (sent.messageId !== null && HOLDING_LINES.has(body)) holding = { messageId: sent.messageId, at: Date.now() }
  }
  const reply = async (body: string, buttons?: { title: string; payload: string }[]) => {
    await send(body, buttons)
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

  // A command from the menu.
  const command = text.match(/^\/([a-z]+)(?:@\w+)?\s*$/i)?.[1]?.toLowerCase() as Command | undefined
  const said = command && (COMMANDS as readonly string[]).includes(command) ? command : null
  const words = dictionaries[candidateLocale(candidate)].whatsapp
  if (said === 'mapa') {
    await reply(words.commandMap(issueAppLink(candidate.id, '/me')))
    return
  }
  if (said === 'preferencias') {
    await reply(words.commandPreferences(issueAppLink(candidate.id, '/me/preferences')))
    return
  }
  if (said === 'ayuda') {
    await reply(words.commandHelp)
    return
  }

  const file = (ref: TelegramFileRef | undefined, fallback: string, mime: string | null): IncomingFile | null =>
    ref ? { name: (ref.file_name ?? fallback).slice(0, 120), mimeType: ref.mime_type ?? mime, fetch: (maxBytes) => fetchFile(config, ref.file_id, maxBytes) } : null
  await handleFromPerson(
    candidate,
    {
      // /ofertas and /pausa are what they would have written.
      text: said === 'ofertas' ? words.commandOffersAsk : said === 'pausa' ? words.commandPauseAsk : text,
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
  // A tap answered with nothing to say: the card still shows what they chose.
  if (card) await markAnswered(config, chatId, card, `✓ ${tapped}`).catch(() => false)
}

// What amble writes is in WhatsApp's marks; under a card it is plain words
// (the card's own marks are offsets, which new marks would have to join).
function plainWords(text: string): string {
  return text.replace(/\*([^*\n]+)\*/g, '$1').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/gm, '$1$2')
}
