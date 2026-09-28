import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { currentCandidate } from '@/lib/auth/session'
import { chooseLocale } from '@/lib/i18n/candidate'
import { isLocale } from '@/lib/i18n/locale'
import { LOCALE_COOKIE } from '@/lib/i18n/server'

export const runtime = 'nodejs'

// POST { locale } -> the candidate's explicit choice. It overrides detection.
// Before signing in, it is kept in a cookie until there is a candidate.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { locale?: unknown }
  if (!isLocale(body.locale)) {
    return NextResponse.json({ error: 'locale must be "en" or "es".' }, { status: 400 })
  }
  const candidate = await currentCandidate()
  if (candidate) chooseLocale(candidate.id, body.locale)
  else (await cookies()).set(LOCALE_COOKIE, body.locale, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  return NextResponse.json({ ok: true, locale: body.locale })
}
