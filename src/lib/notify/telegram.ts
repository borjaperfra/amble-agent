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
 * No dependency: it is one POST.
 */

import type { TelegramConfig } from '@/lib/features'

const API = 'https://api.telegram.org'

/** Telegram refuses anything longer, and refusing is better than truncating. */
export const TELEGRAM_LIMIT = 4096

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
 * Send it, or throw with what Telegram said.
 *
 * The token never reaches the error message: these end up in a job's
 * `last_error`, and a bot token in a database column is a bot somebody else
 * can send messages as.
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  chatId: string,
  text: string,
): Promise<void> {
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
  } | null

  if (!response.ok || body?.ok !== true) {
    throw new TelegramError(
      `Telegram refused it: ${body?.error_code ?? response.status} ${body?.description ?? ''}`.trim(),
      body?.error_code ?? response.status,
    )
  }
}

/**
 * Who has written to the bot.
 *
 * A chat id is not something a person knows about themselves; it exists once
 * they message the bot. This reads the updates so the setup script can say
 * "that was you" instead of asking somebody to find a number.
 */
export async function recentChats(
  config: TelegramConfig,
): Promise<{ id: string; name: string; text: string }[]> {
  const response = await fetch(`${API}/bot${config.token}/getUpdates`, {
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean
    description?: string
    result?: unknown[]
  } | null

  if (body?.ok !== true) {
    throw new TelegramError(`Telegram refused it: ${body?.description ?? response.status}`)
  }

  const chats = new Map<string, { id: string; name: string; text: string }>()
  for (const entry of body.result ?? []) {
    const message = (entry as { message?: Record<string, unknown> }).message
    const chat = message?.chat as Record<string, unknown> | undefined
    if (!chat || chat.id === undefined) continue
    const id = String(chat.id)
    const name = [chat.first_name, chat.last_name, chat.username ? `@${chat.username}` : null]
      .filter(Boolean)
      .join(' ')
    chats.set(id, { id, name: name || id, text: String(message?.text ?? '') })
  }
  return [...chats.values()]
}
