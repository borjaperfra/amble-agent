import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { getDb } from '../db/db'
import { getCandidateByEmail, newId, now, type CandidateRow } from '../db/repo'
import type { Locale } from '../i18n/locale'
import { sendLoginCode } from './email'

// Signing in with a one-time code sent by email: no passwords to keep.
// A code lasts ten minutes and survives five wrong guesses; a new one
// replaces the last. Only its hash is stored.

const CODE_MINUTES = 10
const MAX_ATTEMPTS = 5
// Codes one address can ask for in a quarter of an hour.
const MAX_CODES_PER_WINDOW = 3
const WINDOW_MINUTES = 15

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function hashCode(codeId: string, code: string): string {
  return createHash('sha256').update(`${codeId}:${code}`).digest('hex')
}

export type CodeRequest = { sent: true } | { sent: false; reason: 'too_many' }

// Whether an address has an account is never revealed: the answer is the same
// either way, and only an account receives a code.
export async function requestLoginCode(email: string, locale: Locale): Promise<CodeRequest> {
  const db = getDb()
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
  const recent = db.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?').get(email, since) as { n: number }
  if (recent.n >= MAX_CODES_PER_WINDOW) return { sent: false, reason: 'too_many' }

  const candidate = getCandidateByEmail(email)
  if (!candidate) {
    // Counted like a real one, so the limit says nothing either.
    db.prepare('INSERT INTO login_codes (id, email, code_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      newId('lc'),
      email,
      '',
      now(),
      now(),
      now(),
    )
    return { sent: true }
  }

  const id = newId('lc')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString()
  // A new code replaces any earlier one still waiting.
  db.prepare('UPDATE login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL').run(now(), email)
  db.prepare('INSERT INTO login_codes (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    email,
    hashCode(id, code),
    now(),
    expiresAt,
  )
  await sendLoginCode({ to: email, code, locale: candidate.locale === 'es' || candidate.locale === 'en' ? candidate.locale : locale, idempotencyKey: id })
  return { sent: true }
}

interface LoginCodeRow {
  id: string
  code_hash: string
  attempts: number
  expires_at: string
}

export type CodeCheck = { ok: true; candidate: CandidateRow } | { ok: false; reason: 'wrong' | 'expired' }

export function verifyLoginCode(email: string, code: string): CodeCheck {
  const db = getDb()
  const row = db
    .prepare('SELECT id, code_hash, attempts, expires_at FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(email) as LoginCodeRow | undefined
  if (!row || row.expires_at < now() || row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'expired' }

  const given = Buffer.from(hashCode(row.id, code.replace(/\D/g, '')), 'hex')
  const expected = Buffer.from(row.code_hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
    return { ok: false, reason: row.attempts + 1 >= MAX_ATTEMPTS ? 'expired' : 'wrong' }
  }

  db.prepare('UPDATE login_codes SET used_at = ? WHERE id = ?').run(now(), row.id)
  const candidate = getCandidateByEmail(email)
  return candidate ? { ok: true, candidate } : { ok: false, reason: 'expired' }
}
