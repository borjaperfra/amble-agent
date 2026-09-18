import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate, listSources, listUnprocessedSources } from '@/lib/db/repo'
import { enqueue, hasPendingKind, queueStatus } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/**
 * Start the reading. Returns as soon as the work is on the queue.
 *
 * This used to run every stage inside the request: fifty seconds to read a
 * CV, fifty more to work out capabilities, with the phone holding the
 * connection open through both. A tunnel in the middle of that took the
 * onboarding with it. Now the queue does the work, survives the connection,
 * and /api/onboarding/state tells the screen how far it has got.
 */
export async function POST() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const candidate = getOrCreateCandidate()
  const sources = listUnprocessedSources(candidate.id)

  // Nothing to read and nothing to read from: that is the only real error.
  // Everything already read is not — coming back to this screen after a
  // reload, or a phone waking up mid-run, has to be harmless.
  if (sources.length === 0 && listSources(candidate.id).length === 0) {
    return NextResponse.json(
      { error: 'There are no sources to read. Go back and add one.' },
      { status: 400 },
    )
  }

  for (const source of sources) {
    enqueue('process_source', candidate.id, { sourceId: source.id })
  }

  // Queued behind the reading, and only once: the queue is serial, so by the
  // time this runs every source is in.
  if (sources.length > 0 && !hasPendingKind(candidate.id, 'assess_capabilities')) {
    enqueue('assess_capabilities', candidate.id)
  }

  return NextResponse.json({
    started: sources.map((source) => ({ id: source.id, name: source.name })),
    queue: queueStatus(candidate.id),
  })
}
