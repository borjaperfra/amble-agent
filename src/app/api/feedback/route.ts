import { after, NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { isOwner } from '@/lib/auth/session'
import { emailOwnerAbout, listFeedback, markFeedbackSeen, recordFeedback } from '@/lib/feedback'

export const runtime = 'nodejs'

// POST { message, page }          -> feedback from the app, sent on to the owner
// GET                             -> everything received (owner only)
// POST { action: 'seen', id, seen } -> mark it read (owner only)

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json(listFeedback())
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { message?: unknown; page?: unknown; action?: unknown; id?: unknown; seen?: unknown }

    if (body.action === 'seen') {
      if (candidate.role !== 'owner' || typeof body.id !== 'string') return NextResponse.json({ error: 'Not found.' }, { status: 404 })
      markFeedbackSeen(body.id, body.seen !== false)
      return NextResponse.json({ ok: true })
    }

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (message.length < 2) return NextResponse.json({ error: 'A message is required.' }, { status: 400 })
    const page = typeof body.page === 'string' ? body.page : null
    const row = recordFeedback(candidate, { message, page, channel: 'app' })

    after(() => emailOwnerAbout(candidate, row))
    return NextResponse.json({ ok: true })
  })
}
