import { after, NextResponse } from 'next/server'
import { handleEvent } from '@/lib/whatsapp/inbound'
import { signatureIsValid, zernioConfig } from '@/lib/whatsapp/zernio'

export const runtime = 'nodejs'

// Zernio's deliveries, signed with our secret. Answered at once and handled
// after: some answers take a minute (preparing an application), longer than
// they wait. A retried delivery carries the same id and is handled once.
export async function POST(request: Request) {
  const config = zernioConfig()
  if (!config) return NextResponse.json({ error: 'Not configured.' }, { status: 404 })
  const raw = await request.text()
  if (!signatureIsValid(config, raw, request.headers.get('x-zernio-signature'))) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }
  const event = JSON.parse(raw) as Parameters<typeof handleEvent>[0]
  after(() =>
    handleEvent(event).catch((error) => console.error('[whatsapp] event not handled:', event.id, error instanceof Error ? error.message : error)),
  )
  return NextResponse.json({ ok: true })
}
