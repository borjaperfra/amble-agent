import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate, insertEvaluation } from '@/lib/db/repo'

export const runtime = 'nodejs'

const CAPABILITY_VERDICTS = ['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']
const QUESTION_VERDICTS = ['USEFUL', 'REDUNDANT', 'IRRELEVANT']

/**
 * An interruption decision and the explanation that came with it are judged
 * the same way a capability is: was it accurate, and could it point at what
 * it claimed. Same verdicts, so the two experiments stay comparable.
 */
const OPPORTUNITY_VERDICTS = ['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']

export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
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
        : body.targetType === 'opportunity_decision' ||
            body.targetType === 'opportunity_explanation'
          ? OPPORTUNITY_VERDICTS
          : []

  if (!body.targetId || !allowed.includes(body.verdict ?? '')) {
    return NextResponse.json({ error: 'Invalid evaluation.' }, { status: 400 })
  }

  insertEvaluation({
    id: `eval_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    candidate_id: candidate.id,
    target_type: body.targetType as string,
    target_id: body.targetId,
    verdict: body.verdict as string,
    comment: body.comment?.trim() || null,
  })

  return NextResponse.json({ ok: true })
}
