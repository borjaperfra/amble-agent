import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { readPreferences, writePreferences } from '@/lib/pipeline/preferences'

export const runtime = 'nodejs'

export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  return NextResponse.json(readPreferences(candidate.id))
}

/**
 * Saves whatever fields were sent. A screen that only knows about the
 * notification channel must be able to save it without carrying the salary
 * along and risking writing it back wrong.
 */
export async function PUT(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  }
  return NextResponse.json(writePreferences(candidate.id, body))
}
