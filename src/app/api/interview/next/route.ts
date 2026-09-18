import { NextResponse } from 'next/server'
import { isUserZero, ModelNotConfiguredError } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import {
  getQuestionWithoutWaiting,
  interviewProgress,
  prefetchQuestion,
} from '@/lib/pipeline/interview'
import { queueStatus, resumeQueue } from '@/lib/pipeline/jobs'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'

export async function POST() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  // Whatever brought this process up, there may be work on disk from before
  // it: a job that was running when the server restarted, or one waiting out
  // a backoff with no timer left to wake it.
  resumeQueue()
  try {
    // Never blocks on the model: either a question is ready or the queue is
    // working on one and the client comes back for it.
    const plan = getQuestionWithoutWaiting(candidate.id)
    // Start planning the one after this while the candidate reads and answers.
    if (plan.action === 'ASK') prefetchQuestion(candidate.id)

    const queue = queueStatus(candidate.id)
    return NextResponse.json({
      ...plan,
      progress: interviewProgress(candidate.id),
      // So a phone in a tunnel can say "still trying" instead of "loading".
      retrying: queue.retrying,
      nextAttemptAt: queue.nextAttemptAt,
      stalled: plan.action === 'WAIT' && !queue.busy,
    })
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
