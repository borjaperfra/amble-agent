import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { candidateLocale } from '@/lib/i18n/candidate'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { linkOf, startLink, unlink } from '@/lib/whatsapp/link'
import { zernioConfig } from '@/lib/whatsapp/zernio'

export const runtime = 'nodejs'

// GET                       -> whether WhatsApp is available and linked
// POST { action: 'start' }  -> the wa.me link that links it when they send it
// POST { action: 'unlink' } -> amble stops writing to them there
export async function GET(request: Request) {
  return forCandidate(request, async (candidate) =>
    NextResponse.json({ available: zernioConfig() !== null, linked: linkOf(candidate.id) !== null }),
  )
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown }
    if (body.action === 'unlink') {
      unlink(candidate.id)
      return NextResponse.json({ ok: true })
    }
    if (body.action !== 'start') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    const w = dictionaries[candidateLocale(candidate)].whatsapp
    const started = startLink(candidate.id, w.linkMessage)
    if (!started) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
    return NextResponse.json({ url: started.url })
  })
}
