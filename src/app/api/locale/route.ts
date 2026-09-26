import { NextResponse } from 'next/server'
import { chooseLocale } from '@/lib/i18n/candidate'
import { isLocale } from '@/lib/i18n/locale'

export const runtime = 'nodejs'

// POST { locale } -> the candidate's explicit choice. It overrides detection.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { locale?: unknown }
  if (!isLocale(body.locale)) {
    return NextResponse.json({ error: 'locale must be "en" or "es".' }, { status: 400 })
  }
  chooseLocale(body.locale)
  return NextResponse.json({ ok: true, locale: body.locale })
}
