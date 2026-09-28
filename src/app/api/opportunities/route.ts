import { NextResponse } from 'next/server'
import { getMatch, respondToMatch, type MatchResponse } from '@/lib/db/matching'
import { forCandidate } from '@/lib/auth/request'
import { getOpportunitiesView } from '@/lib/matching/view'

export const runtime = 'nodejs'

const RESPONSES: MatchResponse[] = ['interested', 'not_for_me', 'wanted_anyway']

// GET                                               -> what the Rep found and what it set aside
// POST { matchId, response, reason? }               -> the candidate's answer
//   response: 'interested' | 'not_for_me'  (on something shown)
//             'wanted_anyway'              (overruling a discard)

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => NextResponse.json(getOpportunitiesView(candidate.id)))
}

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => respond(request, candidate.id))
}

async function respond(request: Request, candidateId: string) {
  const body = (await request.json().catch(() => ({}))) as { matchId?: unknown; response?: unknown; reason?: unknown }
  const match = typeof body.matchId === 'string' ? getMatch(body.matchId) : undefined
  if (!match || match.candidate_id !== candidateId) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 })
  }
  if (!RESPONSES.includes(body.response as MatchResponse)) {
    return NextResponse.json({ error: `response must be one of: ${RESPONSES.join(', ')}.` }, { status: 400 })
  }
  const response = body.response as MatchResponse
  // Overruling only makes sense on a discard; answering only on something shown.
  if ((response === 'wanted_anyway') !== (match.verdict !== 'show')) {
    return NextResponse.json({ error: 'That response does not apply to this offer.' }, { status: 409 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 1000) : null
  respondToMatch(match.id, response, reason)
  return NextResponse.json({ ok: true })
}
