import { NextResponse } from 'next/server'
import { normaliseEmail, requestLoginCode } from '@/lib/auth/codes'
import { betaIsFull, openInvitation } from '@/lib/auth/invitations'
import { serverLocale } from '@/lib/i18n/server'

export const runtime = 'nodejs'

// POST { email }            -> a sign-in code by email, if the address has an account.
//                               The answer is the same whether it has one or not.
// POST { email, invitation } -> from an invitation link: a code that creates the account.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; invitation?: unknown }
  const email = normaliseEmail(body.email)
  if (!email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  let invitation = null
  if (body.invitation !== undefined) {
    invitation = typeof body.invitation === 'string' ? openInvitation(body.invitation) : null
    if (!invitation) return NextResponse.json({ error: 'invitation_used' }, { status: 410 })
    if (betaIsFull()) return NextResponse.json({ error: 'beta_full' }, { status: 409 })
  }
  try {
    const result = await requestLoginCode(email, await serverLocale(), invitation)
    if (!result.sent) return NextResponse.json({ error: result.reason }, { status: 429 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[amble] sign-in code not sent:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'failed' }, { status: 502 })
  }
}
