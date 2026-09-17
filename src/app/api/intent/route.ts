import { NextResponse } from 'next/server'
import { isUserZero, ModelNotConfiguredError } from '@/lib/features'
import { confirmLatestIntent, interpretIntent } from '@/lib/pipeline/intent'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const body = (await request.json().catch(() => ({}))) as { action?: string; answer?: string; intentId?: string }

  if (body.action === 'confirm') {
    if (!body.intentId) {
      return NextResponse.json({ error: 'An intent id is required.' }, { status: 400 })
    }
    confirmLatestIntent(body.intentId)
    return NextResponse.json({ ok: true })
  }

  const answer = body.answer?.trim()
  if (!answer) {
    return NextResponse.json({ error: 'An answer is required.' }, { status: 400 })
  }

  try {
    const result = await interpretIntent(answer)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Your intent could not be interpreted.' },
      { status: 500 },
    )
  }
}
