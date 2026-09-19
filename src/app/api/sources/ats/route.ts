import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { configuredAtsAdapters } from '@/lib/sources/ats'
import { enqueue, hasPendingKind, queueStatus } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/**
 * Go and read the boards of the companies worth working for.
 *
 * Which companies is a list, not a crawl: `AMBLE_ATS_BOARDS`. Amble is not
 * trying to see every job in the world, it is watching the handful of places
 * one person would actually go.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const adapters = configuredAtsAdapters()
  if (adapters.length === 0) {
    return NextResponse.json(
      {
        error:
          'No boards configured. Set AMBLE_ATS_BOARDS, e.g. greenhouse:vercel,ashby:posthog.',
      },
      { status: 400 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    limit?: number
    maxEvaluations?: number
  } | null

  const candidate = getOrCreateCandidate()
  if (hasPendingKind(candidate.id, 'sync_ats')) {
    return NextResponse.json({ alreadyRunning: true, queue: queueStatus(candidate.id) })
  }

  const clamp = (value: unknown, fallback: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.min(Math.round(value), max))
      : fallback

  enqueue('sync_ats', candidate.id, {
    limit: clamp(body?.limit, 40, 400),
    maxEvaluations: clamp(body?.maxEvaluations, 10, 60),
  })

  return NextResponse.json({
    alreadyRunning: false,
    boards: adapters.map((adapter) => adapter.source),
    queue: queueStatus(candidate.id),
  })
}
