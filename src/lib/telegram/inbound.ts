import { issueAppLink } from '../auth/applinks'
import { getDb } from '../db/db'
import { getCandidate, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { logMessage } from '../whatsapp/conversation'
import { handleFromPerson, type IncomingFile } from '../whatsapp/inbound'
import { sendDueOffers } from '../whatsapp/offers'
import { allow } from '../whatsapp/throttle'
import { answerTap, fetchFile, markAnswered, reactTo, replaceText, sendText, sendTyping, telegramConfig, type SentMessage, type TelegramButton } from './api'
import { answerShare, type InlineQuery } from './share'
import { approveLogin, loginCodeIn, refuseLogin } from './login'
import { refreshSummary } from './summary'
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

interface TelegramReaction {
  chat: { id: number; type: string }
  message_id: number
  user?: TelegramUser
  new_reaction?: { type: string; emoji?: string }[]
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: { id: string; from: TelegramUser; data?: string; message?: TelegramMessage }
  message_reaction?: TelegramReaction
  inline_query?: InlineQuery
}

// A reaction to an offer's card answers it as one of its buttons would:
// these as «Me interesa», these as «No me encaja»; any other says nothing.
const LIKED = new Set(['👍', '❤', '❤️', '🔥', '😍', '🥰', '🤩', '💯', '👏', '❤‍🔥', '🙏'])
const DISLIKED = new Set(['👎', '💩', '🤮', '🥱', '🤡'])

interface ReactedCard {
  payload: string
  title: string
  messageId: number
  body: string
  keep: TelegramButton[]
}

function reactedCard(chatId: string, reaction: TelegramReaction): ReactedCard | null {
  const emoji = (reaction.new_reaction ?? []).find((item) => item.type === 'emoji')?.emoji
  const answer = emoji && LIKED.has(emoji) ? 'interested' : emoji && DISLIKED.has(emoji) ? 'not_fit' : null
  if (!answer) return null
  const card = getDb()
    .prepare('SELECT candidate_id, match_id, body, url FROM telegram_cards WHERE chat_id = ? AND message_id = ?')
    .get(chatId, reaction.message_id) as { candidate_id: string; match_id: string; body: string; url: string | null } | undefined
  if (!card) return null
  const words = dictionaries[candidateLocale(getCandidate(card.candidate_id) ?? null)].whatsapp.offerButtons
  return {
    payload: `of:${card.match_id}:${answer}`,
    title: `${emoji} ${answer === 'interested' ? words.interested : words.notFit}`,
    messageId: reaction.message_id,
    body: card.body,
    keep: [{ title: words.share, payload: '', share: `of:${card.match_id}` }],
  }
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
  // «@bot …» in any chat: their offers, to share.
  if (update.inline_query) {
    await answerShare(config, update.inline_query).catch((error: unknown) =>
      console.error('[telegram] share not answered:', error instanceof Error ? error.message : error),
    )
    return
  }
  const tap = update.callback_query ?? null
  const reaction = update.message_reaction ?? null
  const message = update.message ?? tap?.message ?? null
  const chat = message?.chat ?? reaction?.chat ?? null
  if (!chat || chat.type !== 'private') return
  const db = getDb()
  const event = tap ? 'telegram.tap' : reaction ? 'telegram.reaction' : 'telegram.message'
  const seen = db.prepare('INSERT OR IGNORE INTO whatsapp_events (id, event, received_at) VALUES (?, ?, ?)').run(`tg:${update.update_id}`, event, now())
  if (seen.changes === 0) return

  const chatId = String(chat.id)
  const from = tap?.from ?? reaction?.user ?? message?.from ?? null
  // The spinner on the button stops at once.
  if (tap) void answerTap(config, tap.id).catch(() => undefined)
  // A reaction to an offer's card is one of its buttons; any other, nothing.
  const reacted = reaction ? reactedCard(chatId, reaction) : null
  if (reaction && !reacted) return
  const payload = tap?.data ?? reacted?.payload ?? null
  // A tap reads as the button's words, as WhatsApp gives them.
  const tapped = tap?.data
    ? (message?.reply_markup?.inline_keyboard ?? []).flat().find((button) => button.callback_data === tap.data)?.text ?? ''
    : (reacted?.title ?? '')
  const text = payload ? tapped : (message?.text ?? message?.caption ?? '').trim()

  let replyTo: string | null = null
  // The card they answered changes where it is (#33): what they chose below
  // it, and the first answer with it when that answer asks for no tap.
  let card: ((line: string) => Promise<boolean>) | null =
    tap && tapped && message
      ? (line) => markAnswered(config, chatId, message as SentMessage, line)
      : reacted
        ? (line) => replaceText(config, chatId, reacted.messageId, `${reacted.body}\n\n${line}`, reacted.keep)
        : null
  // A line saying amble is on it becomes the answer it announced, when that
  // comes soon enough to be seen; later, the answer goes as a new message,
  // which their phone tells them about (an edit it does not).
  let holding: { messageId: number; at: number } | null = null
  const send = async (body: string, buttons?: { title: string; payload: string }[]) => {
    if (card) {
      const mark = card
      card = null
      const choice = `✓ ${tapped}`
      const folded = !buttons?.length && (await mark(`${choice}\n${plainWords(body)}`).catch(() => false))
      if (folded) return
      await mark(choice).catch(() => false)
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
  const linking = !payload && text ? takeStartCode(text) : null
  if (linking) {
    saveTelegramLink(linking, { chatId, userId: from ? String(from.id) : null, username: from?.username ?? null })
    replyTo = linking
    const candidate = getCandidate(linking)
    await reply(dictionaries[candidateLocale(candidate ?? null)].whatsapp.linked(candidate?.name ?? null))
    // What it has already found, now that it can say so.
    await sendDueOffers(linking)
    // And the summary pinned at the top, from the start.
    await refreshSummary(linking).catch((error: unknown) => console.error('[telegram] summary not pinned:', error instanceof Error ? error.message : error))
    return
  }

  // "/start login_<code>" from the login page (#35).
  const login = !payload && text ? loginCodeIn(text) : null
  const link = telegramLinkByChat(chatId)
  if (!link) {
    if (login) {
      await reply(`${dictionaries.es.whatsapp.loginNotLinked}\n\n${dictionaries.en.whatsapp.loginNotLinked}`)
      return
    }
    if (allow('stranger-tg', chatId, STRANGER_REPLIES, STRANGER_WINDOW_MS)) {
      await reply(`${dictionaries.es.whatsapp.unknownTelegram}\n\n${dictionaries.en.whatsapp.unknownTelegram}`)
    }
    return
  }
  touchTelegramLink(link.candidate_id)
  const candidate = getCandidate(link.candidate_id)
  if (!candidate) return
  replyTo = candidate.id
  const words = dictionaries[candidateLocale(candidate)].whatsapp
  // Signing in to a browser: only on their yes, which they are told to give
  // only if they asked for it (a link can be sent to them by someone else).
  if (login) {
    await reply(words.loginConfirm, [
      { title: words.loginButtons.yes, payload: `tl:${login}:yes` },
      { title: words.loginButtons.no, payload: `tl:${login}:no` },
    ])
    return
  }
  const loginTap = payload?.match(/^tl:([A-Za-z0-9_-]{24}):(yes|no)$/)
  if (loginTap) {
    const [, code, answer] = loginTap
    if (answer === 'yes' && approveLogin(code, candidate.id)) {
      await reply(words.loginDone)
      return
    }
    refuseLogin(code)
    await reply(answer === 'yes' ? words.loginExpired : words.loginRefused)
    return
  }
  // "/start" again, from someone already connected: a greeting, not a question.
  if (/^\/start\b/.test(text)) {
    await reply(dictionaries[candidateLocale(candidate)].whatsapp.linked(candidate.name))
    return
  }

  // A command from the menu.
  const command = text.match(/^\/([a-z]+)(?:@\w+)?\s*$/i)?.[1]?.toLowerCase() as Command | undefined
  const said = command && (COMMANDS as readonly string[]).includes(command) ? command : null
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
      interactiveId: payload,
      buttonPayload: null,
      // What a tapped card carries is amble's, not theirs.
      document: payload ? null : file(message?.document, 'Telegram.pdf', null),
      voice: payload ? null : file(message?.voice ?? message?.audio, 'voice.ogg', 'audio/ogg'),
      otherAttachment: !payload && Boolean(message?.photo || message?.video || message?.sticker),
    },
    {
      reply,
      typing: () => void sendTyping(config, chatId).catch(() => undefined),
      react: (emoji) => {
        if (!payload && message) void reactTo(config, chatId, message.message_id, emoji).catch(() => undefined)
      },
    },
  )
  // A tap answered with nothing to say: the card still shows what they chose.
  if (card) await card(`✓ ${tapped}`).catch(() => false)
}

// What amble writes is in WhatsApp's marks; under a card it is plain words
// (the card's own marks are offsets, which new marks would have to join).
function plainWords(text: string): string {
  return text.replace(/\*([^*\n]+)\*/g, '$1').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/gm, '$1$2')
}
