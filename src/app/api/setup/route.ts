import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { completeSetup } from '@/lib/db/repo'
import { isLocale } from '@/lib/i18n/locale'

export const runtime = 'nodejs'

// POST { name, locale } -> the name the Rep will use and the candidate's language.
export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; locale?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
    if (!isLocale(body.locale)) return NextResponse.json({ error: 'locale must be "en" or "es".' }, { status: 400 })
    completeSetup(candidate.id, name, body.locale)
    return NextResponse.json({ ok: true })
  })
}
