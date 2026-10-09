import { timingSafeEqual } from 'node:crypto'
import { TooLargeError } from '../net/safe-fetch'

// Telegram's Bot API, for amble on Telegram (#18): free, no templates, no
// 24-hour window and no review of the bot's name. One bot per environment
// (TELEGRAM_BOT_TOKEN, from @BotFather); its username builds the link that
// connects someone (t.me/<bot>?start=<code>). TELEGRAM_API_URL points the
// calls elsewhere, for tests. Updates reach /api/telegram/webhook with
// TELEGRAM_WEBHOOK_SECRET in their header.

export interface TelegramConfig {
  token: string
  username: string
  webhookSecret: string
  api: string
}

export function telegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!token || !username || !webhookSecret) return null
  return { token, username, webhookSecret, api: (process.env.TELEGRAM_API_URL?.trim() || 'https://api.telegram.org').replace(/\/$/, '') }
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(config: TelegramConfig, method: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const response = await fetch(`${config.api}/bot${config.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  // The token is in the address: never in what is thrown or logged.
  if (!response.ok || !data?.ok) throw new TelegramError(data?.description ?? `Telegram answered ${response.status}`, response.status)
  return data.result as T
}

export interface TelegramButton {
  title: string
  // What comes back on the webhook when it is tapped (at most 64 bytes).
  payload: string
}

// One button a row: their titles can be as long as they need.
function keyboard(buttons: TelegramButton[] | undefined) {
  const usable = (buttons ?? []).filter((button) => Buffer.byteLength(button.payload) <= 64)
  return usable.length ? { reply_markup: { inline_keyboard: usable.map((button) => [{ text: button.title, callback_data: button.payload }]) } } : {}
}

// What amble writes is in WhatsApp's marks (*bold*, _italics_): said in
// Telegram's HTML, everything else escaped so a < in an offer is a <.
export function asTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/gm, '$1<i>$2</i>')
}

// Telegram takes 4096 characters a message: a longer answer goes in parts,
// the buttons under the last.
// Escaped, the words grow a little: cut with room to spare.
const MAX_TEXT = 3800

function parts(text: string): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > MAX_TEXT) {
    const cut = Math.max(rest.lastIndexOf('\n', MAX_TEXT), rest.lastIndexOf(' ', MAX_TEXT), MAX_TEXT / 2)
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  out.push(rest)
  return out
}

export async function sendText(config: TelegramConfig, chatId: string, text: string, buttons?: TelegramButton[]): Promise<{ messageId: number | null }> {
  const pieces = parts(text)
  let last: { message_id?: number } | null = null
  for (const [index, piece] of pieces.entries()) {
    last = await call<{ message_id?: number }>(config, 'sendMessage', {
      chat_id: chatId,
      text: asTelegramHtml(piece),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(index === pieces.length - 1 ? keyboard(buttons) : {}),
    })
  }
  return { messageId: last?.message_id ?? null }
}

// A picture (the filled form) with its text and buttons: uploaded with the
// message, never left at an address. A caption holds 1024 characters: past
// that, the text follows on its own.
const MAX_CAPTION = 900

export async function sendPhoto(
  config: TelegramConfig,
  chatId: string,
  params: { image: Buffer; filename: string; text: string; buttons?: TelegramButton[] },
): Promise<void> {
  const short = params.text.length <= MAX_CAPTION
  const form = new FormData()
  form.set('chat_id', chatId)
  form.set('photo', new Blob([new Uint8Array(params.image)], { type: params.filename.endsWith('.png') ? 'image/png' : 'image/jpeg' }), params.filename)
  if (short) {
    form.set('caption', asTelegramHtml(params.text))
    form.set('parse_mode', 'HTML')
    const markup = keyboard(params.buttons)
    if ('reply_markup' in markup) form.set('reply_markup', JSON.stringify(markup.reply_markup))
  }
  const response = await fetch(`${config.api}/bot${config.token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
  const data = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null
  if (!response.ok || !data?.ok) throw new TelegramError(data?.description ?? `Telegram answered ${response.status}`, response.status)
  if (!short) await sendText(config, chatId, params.text, params.buttons)
}

// "typing…" on their screen, for about five seconds.
export async function sendTyping(config: TelegramConfig, chatId: string): Promise<void> {
  await call(config, 'sendChatAction', { chat_id: chatId, action: 'typing' }, 10_000)
}

// The spinner on a tapped button stops once the tap is acknowledged.
export async function answerTap(config: TelegramConfig, callbackQueryId: string): Promise<void> {
  await call(config, 'answerCallbackQuery', { callback_query_id: callbackQueryId }, 10_000)
}

// A reaction to their message. Telegram takes only some emoji: one it does
// not is left unsaid.
export async function reactTo(config: TelegramConfig, chatId: string, messageId: number, emoji: string): Promise<void> {
  await call(config, 'setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }] }, 10_000)
}

// A file they sent (a CV, a voice note), whole or not at all: past maxBytes
// it is refused, not cut. Bots can fetch files of up to 20 MB.
export async function fetchFile(config: TelegramConfig, fileId: string, maxBytes: number): Promise<Buffer | null> {
  const file = await call<{ file_path?: string; file_size?: number }>(config, 'getFile', { file_id: fileId }, 15_000)
  if (!file.file_path) return null
  if ((file.file_size ?? 0) > maxBytes) throw new TooLargeError(`file of ${file.file_size} bytes`)
  const response = await fetch(`${config.api}/file/bot${config.token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new TooLargeError(`file of ${bytes.length} bytes`)
  return bytes
}

// Where Telegram sends what reaches the bot, and only what amble reads.
export async function setWebhook(config: TelegramConfig, url: string): Promise<void> {
  await call(config, 'setWebhook', { url, secret_token: config.webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
}

// The webhook's header, compared in constant time.
export function secretIsValid(config: TelegramConfig, given: string | null): boolean {
  const a = Buffer.from(given ?? '')
  const b = Buffer.from(config.webhookSecret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function startLink(config: TelegramConfig, code: string): string {
  return `https://t.me/${config.username}?start=${code}`
}
