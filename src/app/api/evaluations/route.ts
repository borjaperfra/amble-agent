import { NextResponse } from 'next/server'
import { forCandidate, textField } from '@/lib/auth/request'
import { insertEvaluation, ownsCapability, ownsTurn } from '@/lib/db/repo'

export const runtime = 'nodejs'

const CAPABILITY_VERDICTS = ['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']
const QUESTION_VERDICTS = ['USEFUL', 'REDUNDANT', 'IRRELEVANT']

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => evaluate(request, candidate.id))
}

async function evaluate(request: Request, candidateId: string) {
  const body = (await request.json().catch(() => ({}))) as {
    targetType?: unknown
    targetId?: unknown
    verdict?: unknown
    comment?: unknown
  }

  const allowed =
    body.targetType === 'capability'
      ? CAPABILITY_VERDICTS
      : body.targetType === 'interview_question'
        ? QUESTION_VERDICTS
        : []

  const targetId = textField(body.targetId, 64)
  const verdict = typeof body.verdict === 'string' && allowed.includes(body.verdict) ? body.verdict : null
  const comment = body.comment === undefined || body.comment === null ? '' : textField(body.comment, 2000)
  if (!targetId || !verdict || comment === null) {
    return NextResponse.json({ error: 'Invalid evaluation.' }, { status: 400 })
  }
  // Only what is the candidate's own can be judged.
  const owned = body.targetType === 'capability' ? ownsCapability(candidateId, targetId) : ownsTurn(candidateId, targetId)
  if (!owned) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  insertEvaluation({
    id: `eval_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    candidate_id: candidateId,
    target_type: body.targetType as string,
    target_id: targetId,
    verdict,
    comment: comment.trim() || null,
  })

  return NextResponse.json({ ok: true })
}
