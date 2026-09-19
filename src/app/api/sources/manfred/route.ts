import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { enqueue, hasPendingKind, queueStatus } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/**
 * Go and see whether anything has arrived.
 *
 * Queued rather than done here: reading forty offer pages politely takes
 * longer than a request should live, and this is the same queue that
 * survives the phone locking. Nothing about it needs a person waiting.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as {
    limit?: number
    maxEvaluations?: number
  } | null

  const candidate = getOrCreateCandidate()
  if (hasPendingKind(candidate.id, 'sync_manfred')) {
    return NextResponse.json({ alreadyRunning: true, queue: queueStatus(candidate.id) })
  }

  const clamp = (value: unknown, fallback: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.min(Math.round(value), max))
      : fallback

  enqueue('sync_manfred', candidate.id, {
    limit: clamp(body?.limit, 40, 400),
    // Every survivor is three model calls and about a minute. The cap is
    // what stops one click turning into a day of compute.
    maxEvaluations: clamp(body?.maxEvaluations, 10, 60),
  })

  return NextResponse.json({ alreadyRunning: false, queue: queueStatus(candidate.id) })
}
