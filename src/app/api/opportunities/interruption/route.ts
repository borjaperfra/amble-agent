import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getPendingInterruption } from '@/lib/opportunity-view'
import { resumeQueue } from '@/lib/pipeline/jobs'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { ensureSyncScheduled } from '@/lib/pipeline/source-sync'
import { ensureInboundPolling } from '@/lib/pipeline/inbound-telegram'
import { resumeUnsentNotices } from '@/lib/pipeline/notify'
import { openQuestionFor } from '@/lib/pipeline/opportunity-questions'
import { getOpportunity } from '@/lib/db/opportunities'

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
  const candidateId = getOrCreateCandidate().id
  ensureSyncScheduled(candidateId, 'sync_manfred')
  ensureSyncScheduled(candidateId, 'sync_ats')
  // And the other direction: if a Telegram chat is set up, somebody should
  // be listening for the answer whether or not this tab stays open.
  ensureInboundPolling(candidateId)
  // And anything that was written while there was nowhere to send it.
  resumeUnsentNotices(candidateId)
  // The question travels with it: the screen that says "nothing worth
  // bothering you with" is the same screen that has to say "one thing,
  // though", and two endpoints for one screen is two things to get wrong.
  const question = openQuestionFor(candidateId)
  const about = question ? getOpportunity(question.opportunity_id) : null

  return NextResponse.json({
    interruption: getPendingInterruption(candidateId),
    question: question
      ? {
          id: question.id,
          question: question.question,
          reason: question.reason,
          company: about?.company ?? null,
          role: about?.role ?? null,
        }
      : null,
  })
}
