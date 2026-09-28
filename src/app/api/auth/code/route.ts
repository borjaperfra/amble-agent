import { NextResponse } from 'next/server'
import { normaliseEmail, requestLoginCode } from '@/lib/auth/codes'
import { serverLocale } from '@/lib/i18n/server'

export const runtime = 'nodejs'

// POST { email } -> a sign-in code by email, if the address has an account.
// The answer is the same whether it has one or not.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown }
  const email = normaliseEmail(body.email)
  if (!email) return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  try {
    const result = await requestLoginCode(email, await serverLocale())
    if (!result.sent) return NextResponse.json({ error: result.reason }, { status: 429 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[amble] sign-in code not sent:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'failed' }, { status: 502 })
  }
}
