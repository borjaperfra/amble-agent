import { NextResponse } from 'next/server'
import { ModelNotConfiguredError } from '@/lib/features'
import { forCandidate } from '@/lib/auth/request'
import { ownsTurn } from '@/lib/db/repo'
import { refreshDerivedProfile } from '@/lib/pipeline/graph'
import { planNextQuestion, takeAnswer } from '@/lib/pipeline/interview'
import { refreshDetectedLocale, serverText } from '@/lib/i18n/candidate'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

// The answer is kept at once and taken into the profile in the background;
// the reply carries the next question, already prepared, so there is no wait
// between one question and the next.
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

  takeAnswer(candidateId, turnId, answer, async (result) => {
    refreshDetectedLocale(candidateId)
    // Presentation only (the map's summary): after the answer is in.
    if (result.profileNeedsRefresh) await refreshDerivedProfile(candidateId)
  })

  try {
    return NextResponse.json({ ok: true, next: await planNextQuestion(candidateId) })
  } catch (error) {
    // The answer is kept whatever happens here: only the next question failed.
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ ok: true, error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ ok: true, error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
    }
    return NextResponse.json({ ok: true, error: error instanceof Error ? error.message : 'The next question failed.' }, { status: 500 })
  }
}
