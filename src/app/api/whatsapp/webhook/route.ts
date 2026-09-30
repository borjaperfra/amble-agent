import { after, NextResponse } from 'next/server'
import { handleEvent } from '@/lib/whatsapp/inbound'
import { signatureIsValid, zernioConfig } from '@/lib/whatsapp/zernio'

export const runtime = 'nodejs'

// A message event is a few kilobytes: a body far larger is not one, and is
// not read into memory to find out.
const MAX_BODY_BYTES = 1024 * 1024

// The body as text, or null past the limit (read in pieces, so a body sent
// without its length is cut off too).
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Zernio's deliveries, signed with our secret. Answered at once and handled
// after: some answers take a minute (preparing an application), longer than
// they wait. A retried delivery carries the same id and is handled once.
export async function POST(request: Request) {
  const config = zernioConfig()
  if (!config) return NextResponse.json({ error: 'Not configured.' }, { status: 404 })
  const raw = await readBody(request)
  if (raw === null) return NextResponse.json({ error: 'Too large.' }, { status: 413 })
  if (!signatureIsValid(config, raw, request.headers.get('x-zernio-signature'))) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }
  let event: Parameters<typeof handleEvent>[0]
  try {
    event = JSON.parse(raw) as Parameters<typeof handleEvent>[0]
  } catch {
    return NextResponse.json({ error: 'Not JSON.' }, { status: 400 })
  }
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') return NextResponse.json({ error: 'No event id.' }, { status: 400 })
  after(() =>
    handleEvent(event).catch((error) => console.error('[whatsapp] event not handled:', event.id, error instanceof Error ? error.message : error)),
  )
  return NextResponse.json({ ok: true })
}
