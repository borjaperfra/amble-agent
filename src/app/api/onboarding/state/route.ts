import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import {
  getOrCreateCandidate,
  listCapabilities,
  listClaims,
  listEvidence,
  listSources,
  listUncertainties,
} from '@/lib/db/repo'
import { discoveriesFrom } from '@/lib/pipeline/sources'
import { queueStatus, resumeQueue } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/**
 * Everything the processing screen needs, rebuilt from what is stored rather
 * than streamed back from the request that started the work.
 *
 * That is the whole point: the reading happens on the queue, so the phone can
 * lock, lose signal or reload, and asking again picks the story back up where
 * it was. A chat transport will ask this same question.
 */
export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  resumeQueue()

  const queue = queueStatus(candidate.id)
  const claims = listClaims(candidate.id)
  const capabilities = listCapabilities(candidate.id)

  const bySource = new Map<string, typeof claims>()
  for (const claim of claims) {
    if (!claim.source_id) continue
    const bucket = bySource.get(claim.source_id) ?? []
    bucket.push(claim)
    bySource.set(claim.source_id, bucket)
  }

  const sources = listSources(candidate.id).map((source) => {
    const own = bySource.get(source.id) ?? []
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      detail: source.status_detail,
      claims: own.length,
      discoveries: discoveriesFrom(own),
    }
  })

  // Only these two kinds are the candidate's business. Building the profile
  // summary and planning the first question run behind the "I have the
  // basics" screen on purpose, and must not hold it back.
  const reading = queue.kinds.includes('process_source')
  const connecting = queue.kinds.includes('assess_capabilities')
  const phase =
    reading
      ? 'reading'
      : connecting
        ? 'connecting'
        : capabilities.length > 0
          ? 'done'
          : queue.recentErrors.length > 0
            ? 'failed'
            : queue.busy
              ? 'reading'
              : 'idle'

  return NextResponse.json({
    phase,
    sources,
    counts: {
      claims: claims.length,
      evidence: listEvidence(candidate.id).length,
      capabilities: capabilities.length,
      uncertainties: listUncertainties(candidate.id, 'OPEN').length,
    },
    queue,
    error: queue.recentErrors[0] ?? null,
  })
}
