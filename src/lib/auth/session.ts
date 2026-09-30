import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getDb } from '../db/db'
import { getCandidate, now, type CandidateRow } from '../db/repo'

// Who the request is for. Pages, route handlers and nothing else ask this:
// everything below them receives the candidate's id.
//
// A session is a random token in an httpOnly cookie; the database keeps only
// its hash, so a copy of the database cannot be used to sign in.

export const SESSION_COOKIE = 'amble_session'
const SESSION_DAYS = 30
// Last use is recorded at most this often, not on every request.
const TOUCH_MINUTES = 60

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

interface SessionRow {
  candidate_id: string
  expires_at: string
  last_seen_at: string
}

export const currentCandidate = cache(async (): Promise<CandidateRow | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const db = getDb()
  const tokenHash = hashToken(token)
  const session = db.prepare('SELECT candidate_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | SessionRow
    | undefined
  if (!session || session.expires_at < now()) return null
  if (Date.now() - Date.parse(session.last_seen_at) > TOUCH_MINUTES * 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now(), tokenHash)
  }
  return getCandidate(session.candidate_id) ?? null
})

// For pages: without a candidate, sign in first.
export async function requireCandidate(): Promise<CandidateRow> {
  const candidate = await currentCandidate()
  if (!candidate) redirect('/login')
  return candidate
}

// For the owner's tools: anyone else finds nothing there.
export async function isOwner(): Promise<boolean> {
  return (await currentCandidate())?.role === 'owner'
}

export async function startSession(candidateId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  // Sessions that ran out are of no use to anyone: they go.
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now())
  getDb()
    .prepare('INSERT INTO sessions (token_hash, candidate_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), candidateId, now(), expires.toISOString(), now())
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  store.delete(SESSION_COOKIE)
}
