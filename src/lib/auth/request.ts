import { NextResponse } from 'next/server'
import type { CandidateRow } from '../db/repo'
import { ModelNotConfiguredError } from '../features'
import { candidateLocale, serverText, withLocale } from '../i18n/candidate'
import { ModelError } from '../model/provider'
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

// A step that failed, answered the same way everywhere: the model not set
// up, the model not answering, or anything else. What went wrong (a
// provider's words, a path, a database error) goes to the log, never to the
// page. `extra` joins the body (an answer kept though the next step failed).
export function failure(scope: string, error: unknown, extra: Record<string, unknown> = {}): Response {
  if (error instanceof ModelNotConfiguredError) return NextResponse.json({ ...extra, error: error.message, unconfigured: true }, { status: 503 })
  const detail = error instanceof ModelError ? [error.message, error.detail].filter(Boolean).join(' · ') : error instanceof Error ? error.message : String(error)
  console.error(`[amble] ${scope} failed:`, detail)
  return NextResponse.json({ ...extra, error: serverText().modelUnavailable }, { status: error instanceof ModelError ? 502 : 500 })
}

// A text field of a request: a string within its length, else null.
export function textField(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}
