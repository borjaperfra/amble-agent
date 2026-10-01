import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/auth/session'
import { betaSeats, InviteRefused, inviteFromWaitlist, MAX_INVITES_PER_REQUEST } from '@/lib/admin/invites'
import { loadWaitlistState } from '@/lib/admin/overview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The owner's view of the site's waitlist. Anyone else finds nothing here.
//
// GET                                   -> { waitlist, seats }
// POST { action: 'invite', emails }     -> an invitation and a letter each (never two)
// POST { action: 'link', emails }       -> an invitation each, only the link

const notFound = () => NextResponse.json({ error: 'Not found.' }, { status: 404 })

export async function GET() {
  if (!(await isOwner())) return notFound()
  return NextResponse.json({ waitlist: await loadWaitlistState(), seats: betaSeats() })
}

export async function POST(request: Request) {
  if (!(await isOwner())) return notFound()
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; emails?: unknown }
  const action = body.action === 'invite' ? 'email' : body.action === 'link' ? 'link' : null
  const emails = Array.isArray(body.emails) ? body.emails.filter((email): email is string => typeof email === 'string' && email.length <= 320) : []
  if (!action || emails.length === 0) return NextResponse.json({ error: 'An action and at least one address are required.' }, { status: 400 })
  if (emails.length > MAX_INVITES_PER_REQUEST) return NextResponse.json({ error: 'too_many', max: MAX_INVITES_PER_REQUEST }, { status: 400 })

  try {
    const outcomes = await inviteFromWaitlist(emails, action)
    return NextResponse.json({ outcomes, waitlist: await loadWaitlistState(), seats: betaSeats() })
  } catch (error) {
    if (error instanceof InviteRefused) {
      return NextResponse.json({ error: error.reason, remaining: error.remaining, seats: betaSeats() }, { status: 409 })
    }
    console.error('[amble] waitlist invitation failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
