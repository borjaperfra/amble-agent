import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { insertEvaluation, ownsCapability, ownsTurn } from '@/lib/db/repo'

export const runtime = 'nodejs'

const CAPABILITY_VERDICTS = ['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']
const QUESTION_VERDICTS = ['USEFUL', 'REDUNDANT', 'IRRELEVANT']

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => evaluate(request, candidate.id))
}

async function evaluate(request: Request, candidateId: string) {
  const body = (await request.json().catch(() => ({}))) as {
    targetType?: string
    targetId?: string
    verdict?: string
    comment?: string
  }

  const allowed =
    body.targetType === 'capability'
      ? CAPABILITY_VERDICTS
      : body.targetType === 'interview_question'
        ? QUESTION_VERDICTS
        : []

  if (!body.targetId || !allowed.includes(body.verdict ?? '')) {
    return NextResponse.json({ error: 'Invalid evaluation.' }, { status: 400 })
  }
  // Only what is the candidate's own can be judged.
  const owned =
    body.targetType === 'capability' ? ownsCapability(candidateId, body.targetId) : ownsTurn(candidateId, body.targetId)
  if (!owned) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  insertEvaluation({
    id: `eval_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    candidate_id: candidateId,
    target_type: body.targetType as string,
    target_id: body.targetId,
    verdict: body.verdict as string,
    comment: body.comment?.trim() || null,
  })

  return NextResponse.json({ ok: true })
}
