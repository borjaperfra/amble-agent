import { after, NextResponse } from 'next/server'
import { secretIsValid, telegramConfig } from '@/lib/telegram/api'
import { handleUpdate, type TelegramUpdate } from '@/lib/telegram/inbound'

export const runtime = 'nodejs'

// An update is a few kilobytes: a body far larger is not one.
const MAX_BODY_BYTES = 1024 * 1024

// Telegram's deliveries, carrying our secret in their header. Answered at
// once and handled after (some answers take a minute); a retried delivery
// carries the same update_id and is handled once.
export async function POST(request: Request) {
  const config = telegramConfig()
  if (!config) return NextResponse.json({ error: 'Not configured.' }, { status: 404 })
  if (!secretIsValid(config, request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'Invalid secret.' }, { status: 401 })
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: 'Too large.' }, { status: 413 })
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Too large.' }, { status: 413 })
  let update: TelegramUpdate
  try {
    update = JSON.parse(raw) as TelegramUpdate
  } catch {
    return NextResponse.json({ error: 'Not JSON.' }, { status: 400 })
  }
  if (!update || typeof update.update_id !== 'number') return NextResponse.json({ error: 'No update id.' }, { status: 400 })
  after(() =>
    handleUpdate(update).catch((error) => console.error('[telegram] update not handled:', update.update_id, error instanceof Error ? error.message : error)),
  )
  return NextResponse.json({ ok: true })
}
