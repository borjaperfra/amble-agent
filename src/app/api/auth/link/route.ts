import { NextResponse } from 'next/server'
import { verifyLoginLink } from '@/lib/auth/codes'
import { startSession } from '@/lib/auth/session'
import { serverLocale } from '@/lib/i18n/server'

export const runtime = 'nodejs'

// POST { token } -> a session, from the link in the sign-in email. A POST, not
// the link itself: mail scanners open links, but they do not press buttons.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown }
  if (typeof body.token !== 'string') return NextResponse.json({ error: 'expired' }, { status: 400 })
  const check = verifyLoginLink(body.token, await serverLocale())
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 })
  await startSession(check.candidate.id)
  return NextResponse.json({ ok: true, joined: check.joined, name: check.candidate.name })
}
