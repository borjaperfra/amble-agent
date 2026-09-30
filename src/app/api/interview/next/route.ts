import { NextResponse } from 'next/server'
import { failure, forCandidate } from '@/lib/auth/request'
import { pendingQuestion, planNextQuestion } from '@/lib/pipeline/interview'
import { setupProgress, startSetup } from '@/lib/pipeline/setup'
import { listUnprocessedSources } from '@/lib/db/repo'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => plan(candidate.id))
}

async function plan(candidateId: string) {
  // Still reading what they shared: the questions come from it.
  const progress = setupProgress(candidateId) ?? (listUnprocessedSources(candidateId).length > 0 ? startSetup(candidateId) : null)
  // The first question is shown as soon as it exists.
  if (progress?.stage === 'questions') {
    const ready = pendingQuestion(candidateId)
    if (ready) return NextResponse.json(ready)
  }
  if (progress && progress.stage !== 'done') {
    // A failed reading is started again, from where it stopped; with nothing
    // left to read, they are told what could not be used.
    const current = progress.stage === 'failed' ? startSetup(candidateId) : progress
    // Only when nothing they shared was usable; a passing failure is retried.
    if (current.stage === 'failed' && current.error === 'nothing_extracted') return NextResponse.json({ action: 'UNREADABLE', progress: current })
    return NextResponse.json({ action: 'WAIT', progress: current })
  }
  try {
    return NextResponse.json(await planNextQuestion(candidateId))
  } catch (error) {
    return failure('next question', error)
  }
}
