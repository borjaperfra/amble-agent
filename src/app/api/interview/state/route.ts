import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { interviewProgress } from '@/lib/pipeline/interview'
import { queueStatus, resumeQueue } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/**
 * Progress plus whether background work is still catching up. The Map waits
 * on this so it never renders a half-updated picture.
 */
export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  resumeQueue()
  return NextResponse.json({
    progress: interviewProgress(candidate.id),
    queue: queueStatus(candidate.id),
  })
}
