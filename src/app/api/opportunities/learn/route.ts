import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { getMatch } from '@/lib/db/matching'
import { learnFromNo } from '@/lib/pipeline/learn-from-no'

export const runtime = 'nodejs'

// After a «no encaja» with a reason, the page asks whether that reason holds
// for other offers too (#42): the rule it would be, kept as a proposal, for
// them to answer under the offers right away. Null when it is about this
// offer alone.
export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { matchId?: unknown; reason?: unknown }
    const match = typeof body.matchId === 'string' ? getMatch(body.matchId) : undefined
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
    if (!match || match.candidate_id !== candidate.id || !reason) return NextResponse.json({ error: 'Match not found.' }, { status: 404 })
    const proposal = await learnFromNo(candidate.id, match.opportunity_id, reason).catch((error) => {
      console.error('[amble] learn from a no failed:', error instanceof Error ? error.message : error)
      return null
    })
    return NextResponse.json({ proposal })
  })
}
