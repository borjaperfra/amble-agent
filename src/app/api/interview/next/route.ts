import { NextResponse } from 'next/server'
import { ModelNotConfiguredError } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { planNextQuestion } from '@/lib/pipeline/interview'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST() {
  const candidate = getOrCreateCandidate()
  try {
    const plan = await planNextQuestion(candidate.id)
    return NextResponse.json(plan)
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
