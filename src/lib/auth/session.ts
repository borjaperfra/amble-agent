import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getOrCreateCandidate, type CandidateRow } from '../db/repo'

// Who the request is for. Pages, route handlers and nothing else ask this:
// everything below them receives the candidate's id.
//
// Until sign-in exists, every request is the owner's.
export const currentCandidate = cache(async (): Promise<CandidateRow | null> => getOrCreateCandidate())

// For pages: without a candidate, sign in first.
export async function requireCandidate(): Promise<CandidateRow> {
  const candidate = await currentCandidate()
  if (!candidate) redirect('/login')
  return candidate
}
