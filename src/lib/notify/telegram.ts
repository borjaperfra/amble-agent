/**
 * Telegram, which is the one place the whole message fits.
 *
 * WhatsApp will not let a business start a conversation without a template
 * approved by Meta in advance — a fixed sentence with slots — so the
 * interruption there can only ever be "your Rep found something, here is a
 * link". The explanation is the product, and a link to the explanation is
 * not the explanation.
 *
 * Telegram has no templates and no approvals. A bot token, a chat id, and
 * the whole thing arrives: the headline, why it is being shown, the evidence
 * behind each claim, and what is still unknown. So this is where the message
 * goes until WhatsApp is worth the paperwork.
 *
 * It is also the only channel that comes back. Email in the other direction
 * needs a webhook, a public URL and a tunnel that stays up; Telegram is us
 * asking, from behind whatever network the laptop is on. So the answer to a
 * question can arrive without anybody opening the app.
 *
 * No dependency: a POST to send, a GET to listen.
 */

import type { TelegramConfig } from '@/lib/features'

const API = 'https://api.telegram.org'

/** Telegram refuses anything longer, and refusing is better than truncating. */
export const TELEGRAM_LIMIT = 4096

/** A message somebody sent to the bot, as far as Amble cares. */
export interface InboundTelegramMessage {
  /** Telegram's cursor. Confirming it is how an update stops coming back. */
  updateId: number
  chatId: string
  /** Whatever the chat calls itself, for the trace. Never used to decide. */
  sender: string
  text: string
  /**
   * The message this one is a reply to, when they quoted one.
   *
   * It is how an answer says which question it belongs to. Telegram's own
   * reply UI fills it in, so it costs the person nothing.
   */
  replyToMessageId: number | null
  /**
   * A voice note, if that is what they sent.
   *
   * Three questions answered out loud take half a minute; typed, they take
   * five. The file has to be fetched and transcribed before it is words.
   */
  voiceFileId: string | null
}

export class TelegramError extends Error {
  readonly code: number | null

  constructor(message: string, code: number | null = null) {
    super(message)
    this.name = 'TelegramError'
    this.code = code
  }

  /** A blocked bot or a chat that does not exist will not fix itself. 429 will. */
  get permanent(): boolean {
    return this.code === 400 || this.code === 403 || this.code === 404
  }
}

/**
 * Cut it at a paragraph if it has to be cut, and say so.
 *
 * Silently losing the last third of the reasons somebody is being shown a
 * job would be worse than telling them where it stopped.
 */
export function fitMessage(text: string, limit = TELEGRAM_LIMIT): string {
  if (text.length <= limit) return text
  const notice = '\n\n…the rest is on the screen.'
  const room = limit - notice.length
  const cut = text.slice(0, room)
  const breakAt = cut.lastIndexOf('\n\n')
  return `${(breakAt > room / 2 ? cut.slice(0, breakAt) : cut).trimEnd()}${notice}`
}

/**
 * Send it, or throw with what Telegram said. Hands back the message id.
 *
 * The id is worth keeping: a reply quotes the message it answers, so it is
 * the only thing that ties an answer to the question it is about when more
 * than one is in flight.
 *
 * The token never reaches the error message: these end up in a job's
 * `last_error`, and a bot token in a database column is a bot somebody else
 * can send messages as.
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  chatId: string,
  text: string,
): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(`${API}/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: fitMessage(text),
        // The link at the end is an invitation to open the screen, not a
        // card to look at instead of reading the message.
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw new TelegramError(
      `Could not reach Telegram: ${error instanceof Error ? error.message : 'no answer'}`,
    )
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean
    error_code?: number
    description?: string
    result?: { message_id?: number }
  } | null

  if (!response.ok || body?.ok !== true) {
    throw new TelegramError(
      `Telegram refused it: ${body?.error_code ?? response.status} ${body?.description ?? ''}`.trim(),
      body?.error_code ?? response.status,
    )
  }

  const messageId = body.result?.message_id
  return typeof messageId === 'number' ? String(messageId) : null
}

/**
 * What has arrived since the last one we wrote down.
 *
 * This is the only two-way channel that works from a laptop. Email in the
 * other direction needs a webhook, which needs a public URL and a tunnel
 * that stays up; `getUpdates` is us asking Telegram, from behind whatever
 * network we happen to be on.
 *
 * `offset` is a confirmation, not a filter: asking for updates from N tells
 * Telegram that everything before N is safely ours and it may forget it. So
 * the offset comes from what is in the database, never from a number held
 * in this process — a reply confirmed by a poll that then died would be a
 * reply nobody ever reads.
 */
export async function fetchUpdates(
  config: TelegramConfig,
  offset: number | null,
): Promise<InboundTelegramMessage[]> {
  const query = new URLSearchParams({
    // Ask and come back. A long poll on a serial lane is a lane held open,
    // and a request that outlives its own timeout is a request that fails.
    timeout: '0',
    allowed_updates: '["message"]',
  })
  if (offset !== null) query.set('offset', String(offset))

  const updates = await getUpdates(config, query)
  const messages: InboundTelegramMessage[] = []
  for (const update of updates) {
    const message = asMessage(update)
    if (!message) continue
    messages.push(message)
  }
  return messages
}

/**
 * Who has written to the bot.
 *
 * A chat id is not something a person knows about themselves; it exists once
 * they message the bot. This reads the updates so the setup script can say
 * "that was you" instead of asking somebody to find a number.
 *
 * Deliberately without an offset: this is somebody setting the bot up, and
 * confirming the updates here would mean the first message they send is the
 * one that disappears.
 */
export async function recentChats(
  config: TelegramConfig,
): Promise<{ id: string; name: string; text: string }[]> {
  const updates = await getUpdates(config, new URLSearchParams())
  const chats = new Map<string, { id: string; name: string; text: string }>()
  for (const update of updates) {
    const message = asMessage(update)
    if (!message) continue
    chats.set(message.chatId, {
      id: message.chatId,
      name: message.sender || message.chatId,
      text: message.text,
    })
  }
  return [...chats.values()]
}

/**
 * El audio, en bytes.
 *
 * Telegram no manda el fichero: manda un id con el que se pide una ruta, y
 * la ruta se descarga de otro host. Dos llamadas, y el token va en las dos,
 * así que ninguna de las dos puede acabar en un mensaje de error.
 */
export async function fetchVoice(
  config: TelegramConfig,
  fileId: string,
): Promise<{ blob: Blob; filename: string }> {
  const described = await fetch(
    `${API}/bot${config.token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { signal: AbortSignal.timeout(config.timeoutMs) },
  ).catch(() => null)

  const body = (await described?.json().catch(() => null)) as {
    ok?: boolean
    description?: string
    result?: { file_path?: string }
  } | null

  const path = body?.ok === true ? body.result?.file_path : undefined
  if (!path) {
    throw new TelegramError(`Telegram would not hand over the audio: ${body?.description ?? '?'}`)
  }

  const file = await fetch(`${API}/file/bot${config.token}/${path}`, {
    // Un audio de un minuto pesa poco, pero la red de este sitio es lenta a
    // ratos y el timeout de los mensajes es demasiado corto para un fichero.
    signal: AbortSignal.timeout(config.timeoutMs * 4),
  }).catch(() => null)

  if (!file?.ok) throw new TelegramError('The audio did not download.')
  return { blob: await file.blob(), filename: path.split('/').pop() || 'voice.ogg' }
}

async function getUpdates(config: TelegramConfig, query: URLSearchParams): Promise<unknown[]> {
  const suffix = query.size > 0 ? `?${query}` : ''
  let response: Response
  try {
    response = await fetch(`${API}/bot${config.token}/getUpdates${suffix}`, {
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw new TelegramError(
      `Could not reach Telegram: ${error instanceof Error ? error.message : 'no answer'}`,
    )
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean
    error_code?: number
    description?: string
    result?: unknown[]
  } | null

  if (body?.ok !== true) {
    throw new TelegramError(
      `Telegram refused it: ${body?.error_code ?? response.status} ${body?.description ?? ''}`.trim(),
      body?.error_code ?? response.status,
    )
  }
  return body.result ?? []
}

/**
 * One update, as far as we care about it.
 *
 * Anything that is not a text message in a chat is dropped here — an edited
 * message, a photo, somebody joining. Dropping it still costs its update id,
 * which is what keeps the cursor moving past things we will never read.
 */
function asMessage(update: unknown): InboundTelegramMessage | null {
  const entry = update as { update_id?: number; message?: Record<string, unknown> }
  const updateId = entry?.update_id
  if (typeof updateId !== 'number') return null

  const message = entry.message
  const chat = message?.chat as Record<string, unknown> | undefined
  if (!chat || chat.id === undefined) return null

  const sender = [chat.first_name, chat.last_name, chat.username ? `@${chat.username}` : null]
    .filter(Boolean)
    .join(' ')

  const replyTo = (message?.reply_to_message as { message_id?: number } | undefined)?.message_id

  // Una nota de voz, un audio adjunto o un vídeo redondo: los tres son
  // alguien hablando, y los tres se transcriben igual.
  const spoken = (message?.voice ?? message?.audio ?? message?.video_note) as
    | { file_id?: string }
    | undefined

  return {
    updateId,
    chatId: String(chat.id),
    sender,
    text: typeof message?.text === 'string' ? message.text : '',
    replyToMessageId: typeof replyTo === 'number' ? replyTo : null,
    voiceFileId: typeof spoken?.file_id === 'string' ? spoken.file_id : null,
  }
}
