import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/auth/session'
import { listAdminFeedback, triageAvailable, triagePending, untriagedCount } from '@/lib/admin/feedback-triage'
import { markFeedbackDone, markFeedbackSeen } from '@/lib/feedback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Feedback for the owner, by importance. Anyone else finds nothing here.
//
// GET                                -> { feedback, untriaged, triageAvailable }
// POST { action: 'triage' }          -> read a few not yet sorted
// POST { action: 'seen', id, seen }  -> mark it read or not
// POST { action: 'done', id, done, note? } -> acted on (an issue, a commit) or back to pending

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

function state() {
  return { feedback: listAdminFeedback(), untriaged: untriagedCount(), triageAvailable: triageAvailable() }
}

export async function GET() {
  if (!(await isOwner())) return notFound()
  return NextResponse.json(state())
}

export async function POST(request: Request) {
  if (!(await isOwner())) return notFound()
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; id?: unknown; seen?: unknown; done?: unknown; note?: unknown }

  if (body.action === 'seen' && typeof body.id === 'string') {
    markFeedbackSeen(body.id, body.seen !== false)
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'done' && typeof body.id === 'string') {
    markFeedbackDone(body.id, body.done !== false, typeof body.note === 'string' ? body.note : null)
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'triage') {
    const result = await triagePending()
    return NextResponse.json({ ...result, ...state() })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
