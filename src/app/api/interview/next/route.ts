import { NextResponse } from 'next/server'
import { ModelNotConfiguredError } from '@/lib/features'
import { forCandidate } from '@/lib/auth/request'
import { planNextQuestion } from '@/lib/pipeline/interview'
import { ModelError } from '@/lib/model/provider'
import { serverText } from '@/lib/i18n/candidate'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => plan(candidate.id))
}

async function plan(candidateId: string) {
  try {
    return NextResponse.json(await planNextQuestion(candidateId))
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Planning the next question failed.' },
      { status: 500 },
    )
  }
}
