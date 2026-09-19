import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { getOpportunity } from '@/lib/db/opportunities'
import { answerQuestion, openQuestionFor } from '@/lib/pipeline/opportunity-questions'
import { resumeQueue } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/**
 * The one thing the Rep is waiting on, if anything.
 *
 * `null` is the normal answer, the same way it is for an interruption:
 * having nothing to ask is the healthy state, not an empty result.
 */
export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  resumeQueue()

  const candidate = getOrCreateCandidate()
  const question = openQuestionFor(candidate.id)
  if (!question) return NextResponse.json({ question: null })

  const opportunity = getOpportunity(question.opportunity_id)
  return NextResponse.json({
    question: {
      id: question.id,
      question: question.question,
      // Why it is being asked, in terms of the job rather than of our
      // filing: nobody should have to care what an "unknown" is.
      reason: question.reason,
      company: opportunity?.company ?? null,
      role: opportunity?.role ?? null,
      askedAt: question.created_at,
    },
  })
}

/**
 * Their answer. Stored before anything else happens.
 *
 * Reading it into the graph takes a model and the better part of a minute,
 * and losing what somebody typed because that failed afterwards would be
 * unforgivable. So this returns as soon as it is written down.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as {
    questionId?: string
    answer?: string
  } | null

  if (!body?.questionId) {
    return NextResponse.json({ error: 'Which question?' }, { status: 400 })
  }

  const result = answerQuestion(body.questionId, body.answer ?? '')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}
