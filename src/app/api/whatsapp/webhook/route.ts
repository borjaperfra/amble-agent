import { NextResponse } from 'next/server'
import { handleEvent } from '@/lib/whatsapp/inbound'
import { signatureIsValid, zernioConfig } from '@/lib/whatsapp/zernio'

export const runtime = 'nodejs'

// Zernio's deliveries, signed with our secret. Answered only once handled: an
// event that fails is retried by them with the same id, and handled once.
export async function POST(request: Request) {
  const config = zernioConfig()
  if (!config) return NextResponse.json({ error: 'Not configured.' }, { status: 404 })
  const raw = await request.text()
  if (!signatureIsValid(config, raw, request.headers.get('x-zernio-signature'))) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }
  const event = JSON.parse(raw) as Parameters<typeof handleEvent>[0]
  try {
    await handleEvent(event)
  } catch (error) {
    console.error('[whatsapp] event not handled:', event.id, error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Not handled.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
