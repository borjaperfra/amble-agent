import { NextResponse } from 'next/server'
import { startSession } from '@/lib/auth/session'
import { telegramConfig } from '@/lib/telegram/api'
import { candidateFromInitData } from '@/lib/telegram/login'

export const runtime = 'nodejs'

// The Mini App (#34): what Telegram signed for the page says whose chat
// opened it, and that account is signed in inside Telegram.
const MAX_INIT_DATA = 4096

export async function POST(request: Request) {
  const config = telegramConfig()
  if (!config) return NextResponse.json({ error: 'not_configured' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as {
    initData?: unknown
  }
  const initData = typeof body.initData === 'string' && body.initData.length <= MAX_INIT_DATA ? body.initData : ''
  const candidateId = initData ? candidateFromInitData(initData, config.token) : null
  if (!candidateId) return NextResponse.json({ error: 'not_linked' }, { status: 403 })
  await startSession(candidateId)
  return NextResponse.json({ ok: true })
}
