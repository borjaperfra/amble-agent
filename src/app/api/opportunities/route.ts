import { NextResponse } from 'next/server'
import { getMatch, respondAsApplied, respondToMatch, setProgress, type MatchProgress, type MatchResponse } from '@/lib/db/matching'
import { forCandidate } from '@/lib/auth/request'
import { getOpportunitiesView } from '@/lib/matching/view'
import { learnFromNo } from '@/lib/pipeline/learn-from-no'
import { reportedClosed, SAYS_CLOSED } from '@/lib/sourcing/liveness'

export const runtime = 'nodejs'

const RESPONSES: MatchResponse[] = ['interested', 'not_for_me', 'wanted_anyway', 'later']
const PROGRESS: (MatchProgress | null)[] = ['applied', 'dropped', null]

// GET                                               -> what the Rep found and what it set aside
// POST { matchId, response, reason? }               -> the candidate's answer
//   response: 'interested' | 'not_for_me' | 'later'  (on something shown)
//             'already_applied'            (on something shown: they sent it on their own)
//             'wanted_anyway'              (overruling a discard)
// POST { opportunityIds, progress }                 -> how far they took an offer they wanted
//   progress: 'applied' | 'dropped' | null (taken back)

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => NextResponse.json(getOpportunitiesView(candidate.id)))
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    return 'progress' in body ? progress(body, candidate.id) : respond(body, candidate.id)
  })
}

function respond(body: Record<string, unknown>, candidateId: string) {
  const match = typeof body.matchId === 'string' ? getMatch(body.matchId) : undefined
  if (!match || match.candidate_id !== candidateId) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 })
  }
  // Already sent on their own: wanted and applied at once, on something shown.
  if (body.response === 'already_applied') {
    if (match.verdict !== 'show') return NextResponse.json({ error: 'That response does not apply to this offer.' }, { status: 409 })
    respondAsApplied(match.id, candidateId)
    return NextResponse.json({ ok: true })
  }
  if (!RESPONSES.includes(body.response as MatchResponse)) {
    return NextResponse.json({ error: `response must be one of: ${RESPONSES.join(', ')}, already_applied.` }, { status: 400 })
  }
  const response = body.response as MatchResponse
  // Overruling only makes sense on a discard; answering only on something shown.
  if ((response === 'wanted_anyway') !== (match.verdict !== 'show')) {
    return NextResponse.json({ error: 'That response does not apply to this offer.' }, { status: 409 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null
  respondToMatch(match.id, candidateId, response, reason)
  // A reason that may hold for offers like it proposes a rule, after the
  // answer is saved and without making them wait (learn-from-no.ts).
  // «Está caducada»: its link is opened, and if it is closed it closes for everyone.
  if (response === 'not_for_me' && reason && SAYS_CLOSED.test(reason)) {
    void reportedClosed(match.opportunity_id).catch((error) => console.error('[amble] closed offer check failed:', error instanceof Error ? error.message : error))
  }
  if (response === 'not_for_me' && reason) {
    void learnFromNo(candidateId, match.opportunity_id, reason).catch((error) => console.error('[amble] learn from a no failed:', error instanceof Error ? error.message : error))
  }
  return NextResponse.json({ ok: true })
}

function progress(body: Record<string, unknown>, candidateId: string) {
  const ids = Array.isArray(body.opportunityIds) ? body.opportunityIds.filter((id): id is string => typeof id === 'string').slice(0, 50) : []
  if (ids.length === 0 || !PROGRESS.includes(body.progress as MatchProgress | null)) {
    return NextResponse.json({ error: 'opportunityIds and progress (applied, dropped or null) are required.' }, { status: 400 })
  }
  // Only offers this candidate said they wanted change; anything else is not theirs to mark.
  if (setProgress(candidateId, ids, body.progress as MatchProgress | null) === 0) {
    return NextResponse.json({ error: 'Offer not found.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
