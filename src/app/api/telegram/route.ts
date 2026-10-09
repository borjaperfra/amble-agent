import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { telegramConfig } from '@/lib/telegram/api'
import { startTelegramLink, telegramLinkOf, unlinkTelegram } from '@/lib/telegram/link'

export const runtime = 'nodejs'

// GET                       -> whether Telegram is available and connected
// POST { action: 'start' }  -> the t.me link that connects it when they tap «Start»
// POST { action: 'unlink' } -> amble stops writing to them there
export async function GET(request: Request) {
  return forCandidate(request, async (candidate) =>
    NextResponse.json({ available: telegramConfig() !== null, linked: telegramLinkOf(candidate.id) !== null }),
  )
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown }
    if (body.action === 'unlink') {
      unlinkTelegram(candidate.id)
      return NextResponse.json({ ok: true })
    }
    if (body.action !== 'start') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    const started = startTelegramLink(candidate.id)
    if (!started) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    return NextResponse.json({ url: started.url })
  })
}
