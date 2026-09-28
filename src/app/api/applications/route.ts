import fs from 'node:fs'
import { NextResponse } from 'next/server'
import { saveAnswer } from '@/lib/apply/answers'
import { applicationState, cancelApplication, fillApplication, screenshotPath, submitApplication } from '@/lib/apply/browser'
import { NotWantedError, prepareApplication } from '@/lib/apply/prepare'
import { forCandidate } from '@/lib/auth/request'
import { setProgress } from '@/lib/db/matching'
import { ModelNotConfiguredError } from '@/lib/features'
import { serverText } from '@/lib/i18n/candidate'
import { ModelError } from '@/lib/model/provider'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST { opportunityId }                              -> prepare (or prepare again) the application
// POST { action: 'answer', label, answer }            -> something only the candidate can answer, kept for next time
// POST { action: 'fill', opportunityId }              -> fill the form in a browser amble opens; a screenshot to review
// POST { action: 'submit', opportunityId, confirm }   -> send it, only when the candidate says so
// POST { action: 'cancel', opportunityId }            -> close the form without sending
// GET  ?screenshot=filled|sent&opportunityId=...      -> the picture of the form

// Filling needs a prepared draft, which exists only for an offer the candidate
// wants; sending needs the form they filled, still open. Both are keyed by the
// signed-in candidate.

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => {
    const params = new URL(request.url).searchParams
    const moment = params.get('screenshot')
    const opportunityId = params.get('opportunityId') ?? ''
    if ((moment !== 'filled' && moment !== 'sent') || !opportunityId) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    // The path is built from the signed-in candidate: nobody sees another's form.
    const file = screenshotPath(candidate.id, opportunityId.replace(/[^A-Za-z0-9_-]/g, ''), moment)
    if (!fs.existsSync(file)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
  })
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; opportunityId?: unknown; label?: unknown; answer?: unknown; confirm?: unknown }
    const action = typeof body.action === 'string' ? body.action : 'prepare'
    const opportunityId = typeof body.opportunityId === 'string' ? body.opportunityId : ''
    try {
      if (action === 'answer') {
        if (typeof body.label !== 'string' || typeof body.answer !== 'string') return NextResponse.json({ error: 'label and answer are required.' }, { status: 400 })
        saveAnswer(candidate.id, body.label, body.answer)
        return NextResponse.json({ ok: true })
      }
      if (!opportunityId) return NextResponse.json({ error: 'opportunityId is required.' }, { status: 400 })
      if (action === 'prepare') return NextResponse.json(await prepareApplication(candidate.id, opportunityId))
      if (action === 'fill') return NextResponse.json(await fillApplication(candidate.id, opportunityId))
      if (action === 'submit') {
        // Sending is theirs: never without an explicit yes in this very request.
        if (body.confirm !== true) return NextResponse.json({ error: 'Sending needs the candidate’s confirmation.' }, { status: 400 })
        const result = await submitApplication(candidate.id, opportunityId)
        if (result.status === 'sent') setProgress(candidate.id, [opportunityId], 'applied')
        return NextResponse.json(result)
      }
      if (action === 'status') return NextResponse.json({ state: applicationState(candidate.id, opportunityId) })
      if (action === 'cancel') {
        await cancelApplication(candidate.id, opportunityId)
        return NextResponse.json({ ok: true })
      }
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    } catch (error) {
      if (error instanceof NotWantedError) return NextResponse.json({ error: 'Offer not found.' }, { status: 404 })
      if (error instanceof ModelNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 503 })
      if (error instanceof ModelError) return NextResponse.json({ error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
      return NextResponse.json({ error: error instanceof Error ? error.message : 'The application step failed.' }, { status: 500 })
    }
  })
}
