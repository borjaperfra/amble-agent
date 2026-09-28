import { NextResponse } from 'next/server'
import { normaliseEmail, verifyLoginCode } from '@/lib/auth/codes'
import { startSession } from '@/lib/auth/session'
import { serverLocale } from '@/lib/i18n/server'

export const runtime = 'nodejs'

// POST { email, code } -> a session, when the code is the one sent. A code
// asked for from an invitation creates the account first.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown }
  const email = normaliseEmail(body.email)
  if (!email || typeof body.code !== 'string') return NextResponse.json({ error: 'wrong' }, { status: 400 })
  const check = verifyLoginCode(email, body.code, await serverLocale())
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 })
  await startSession(check.candidate.id)
  return NextResponse.json({ ok: true, joined: check.joined })
}
