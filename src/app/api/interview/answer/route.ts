import { NextResponse } from 'next/server'
import { isUserZero, ModelNotConfiguredError } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { incorporateAnswer } from '@/lib/pipeline/interview'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  const body = (await request.json().catch(() => ({}))) as { turnId?: string; answer?: string }
  const turnId = body.turnId?.trim()
  const answer = body.answer?.trim()
  if (!turnId || !answer) {
    return NextResponse.json({ error: 'A turn id and an answer are required.' }, { status: 400 })
  }

  try {
    const result = await incorporateAnswer(candidate.id, turnId, answer)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Your answer could not be incorporated.' },
      { status: 500 },
    )
  }
}
