import { NextResponse } from 'next/server'
import type { CandidateRow } from '../db/repo'
import { candidateLocale, withLocale } from '../i18n/candidate'
import { currentCandidate } from './session'

// A route handler acting for the signed-in candidate, with the server's
// messages in their language. Without a candidate, nothing runs.
export async function forCandidate(
  request: Request,
  handler: (candidate: CandidateRow) => Promise<Response> | Response,
): Promise<Response> {
  const candidate = await currentCandidate()
  if (!candidate) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  return withLocale(candidateLocale(candidate, request.headers.get('accept-language')), () => handler(candidate))
}
