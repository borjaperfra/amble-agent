import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getPendingInterruption } from '@/lib/opportunity-view'
import { resumeQueue } from '@/lib/pipeline/jobs'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { ensureManfredSyncScheduled } from '@/lib/pipeline/manfred-sync'

export const runtime = 'nodejs'

/**
 * The one thing worth showing, or nothing.
 *
 * The listening screen asks this every few seconds, which is the whole
 * shape of the product from a phone: the reading happens on the queue, and
 * the screen finds out afterwards. `null` is the normal answer and is not
 * an error — HOLD and IGNORE never appear here, so there is nothing to
 * report about them and nothing to get through.
 */
export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  resumeQueue()
  // The listening screen asks this every few seconds, which makes it the
  // cheapest heartbeat in the app: if the recurring sync is configured and
  // nothing is queued, this is where it gets put back on.
  ensureManfredSyncScheduled(getOrCreateCandidate().id)
  return NextResponse.json({ interruption: getPendingInterruption() })
}
