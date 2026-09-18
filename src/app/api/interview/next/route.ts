import { NextResponse } from 'next/server'
import { isUserZero, ModelNotConfiguredError } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { getCurrentQuestion, interviewProgress, prefetchQuestion } from '@/lib/pipeline/interview'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  try {
    const plan = await getCurrentQuestion(candidate.id)
    // Start planning the one after this while the candidate reads and answers.
    if (plan.action === 'ASK') prefetchQuestion(candidate.id)
    return NextResponse.json({ ...plan, progress: interviewProgress(candidate.id) })
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Planning the next question failed.' },
      { status: 500 },
    )
  }
}
