import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { recordCandidateResponse } from '@/lib/pipeline/opportunities'
import { CANDIDATE_RESPONSES, type CandidateResponse } from '@/domains/opportunity/types'

export const runtime = 'nodejs'

/**
 * What the candidate said about one interruption.
 *
 * It is recorded and that is all. Turning this one down does not narrow
 * what the Rep listens for: a single no is about this role, not about the
 * shape of everything they want, and quietly rewriting their Intent Profile
 * from a tap would undo the thing they were asked to confirm.
 */
export async function POST(request: Request, context: RouteContext<'/api/opportunities/[id]/response'>) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { response?: string } | null
  const response = body?.response

  if (!response || !(CANDIDATE_RESPONSES as readonly string[]).includes(response)) {
    return NextResponse.json({ error: 'That is not one of the answers.' }, { status: 400 })
  }

  const result = recordCandidateResponse(id, response as CandidateResponse)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })

  return NextResponse.json({ ok: true })
}
