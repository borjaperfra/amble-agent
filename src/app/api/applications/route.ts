import { NextResponse } from 'next/server'
import { NotWantedError, prepareApplication } from '@/lib/apply/prepare'
import { forCandidate } from '@/lib/auth/request'
import { ModelNotConfiguredError } from '@/lib/features'
import { serverText } from '@/lib/i18n/candidate'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST { opportunityId } -> prepare (or prepare again) the application to an
// offer the candidate wants: advice, a message and the form's answers.
export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { opportunityId?: unknown }
    if (typeof body.opportunityId !== 'string') return NextResponse.json({ error: 'opportunityId is required.' }, { status: 400 })
    try {
      return NextResponse.json(await prepareApplication(candidate.id, body.opportunityId))
    } catch (error) {
      if (error instanceof NotWantedError) return NextResponse.json({ error: 'Offer not found.' }, { status: 404 })
      if (error instanceof ModelNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 503 })
      if (error instanceof ModelError) return NextResponse.json({ error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Preparing failed.' }, { status: 500 })
    }
  })
}
