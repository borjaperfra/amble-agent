import { after, NextResponse } from 'next/server'
import { ModelNotConfiguredError } from '@/lib/features'
import { forCandidate } from '@/lib/auth/request'
import { ownsTurn } from '@/lib/db/repo'
import { refreshDerivedProfile } from '@/lib/pipeline/graph'
import { incorporateAnswer } from '@/lib/pipeline/interview'
import { refreshDetectedLocale, serverText } from '@/lib/i18n/candidate'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => answer(request, candidate.id))
}

async function answer(request: Request, candidateId: string) {
  const body = (await request.json().catch(() => ({}))) as { turnId?: string; answer?: string }
  const turnId = body.turnId?.trim()
  const answer = body.answer?.trim()
  if (!turnId || !answer) {
    return NextResponse.json({ error: 'A turn id and an answer are required.' }, { status: 400 })
  }
  if (!ownsTurn(candidateId, turnId)) return NextResponse.json({ error: 'Question not found.' }, { status: 404 })

  try {
    const result = await incorporateAnswer(candidateId, turnId, answer)
    refreshDetectedLocale(candidateId)
    if (result.profileNeedsRefresh) {
      // Presentation only (the map's summary), and two model calls: the
      // candidate should not wait for it before the next question.
      after(() => refreshDerivedProfile(candidateId).catch(() => undefined))
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Your answer could not be incorporated.' },
      { status: 500 },
    )
  }
}
