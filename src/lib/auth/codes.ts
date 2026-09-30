import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { getDb, inTransaction } from '../db/db'
import { getCandidateByEmail, newId, now, type CandidateRow } from '../db/repo'
import type { Locale } from '../i18n/locale'
import { sendLoginCode } from './email'
import { acceptInvitation, betaIsFull, getInvitation, type InvitationRow } from './invitations'

// Signing in with a one-time code sent by email: no passwords to keep.
// A code lasts ten minutes and survives five wrong guesses; a new one
// replaces the last. The same email carries a link that does what the code
// does, for someone reading it on the device they sign in on; using either
// spends both. Only hashes of the code and the link are stored.

const CODE_MINUTES = 10
const MAX_ATTEMPTS = 5
// Codes one address can ask for in a quarter of an hour, and in a day: five
// guesses at each, so a stranger has a handful of tries a day at a million.
const MAX_CODES_PER_WINDOW = 3
const WINDOW_MINUTES = 15
const MAX_CODES_PER_DAY = 10
const DAY_MS = 24 * 60 * 60 * 1000

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function hashCode(codeId: string, code: string): string {
  return createHash('sha256').update(`${codeId}:${code}`).digest('hex')
}

function hashLink(token: string): string {
  return createHash('sha256').update(`link:${token}`).digest('hex')
}

export function signInLink(token: string): string {
  const base = (process.env.AMBLE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/login/link?token=${encodeURIComponent(token)}`
}

// `deliver` sends the email: the caller does it after answering, so how long
// the answer takes never says whether there was an email to send.
export type CodeRequest = { sent: true; deliver: (() => Promise<void>) | null } | { sent: false; reason: 'too_many' }

// Whether an address has an account is never revealed: the answer is the same
// either way, as fast either way, and only an account receives a code. From
// an open invitation, an address without an account receives one too: using
// it creates the account. An address that already has one simply signs in,
// and the invitation stays unused.
export function requestLoginCode(email: string, locale: Locale, invitation: InvitationRow | null = null): CodeRequest {
  const db = getDb()
  // What was asked more than a day ago counts for nothing: it goes, with
  // the addresses of people who have no account.
  db.prepare('DELETE FROM login_codes WHERE created_at <= ?').run(new Date(Date.now() - DAY_MS).toISOString())
  const count = (since: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?').get(email, new Date(Date.now() - since).toISOString()) as { n: number }).n
  if (count(WINDOW_MINUTES * 60_000) >= MAX_CODES_PER_WINDOW || count(DAY_MS) >= MAX_CODES_PER_DAY) return { sent: false, reason: 'too_many' }

  const candidate = getCandidateByEmail(email)
  const joining = !candidate && invitation !== null
  if (!candidate && !joining) {
    // Counted like a real one, so the limit says nothing either.
    db.prepare('INSERT INTO login_codes (id, email, code_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      newId('lc'),
      email,
      '',
      now(),
      now(),
      now(),
    )
    return { sent: true, deliver: null }
  }

  const id = newId('lc')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const linkToken = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString()
  // A new code replaces any earlier one still waiting.
  db.prepare('UPDATE login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL').run(now(), email)
  db.prepare(
    'INSERT INTO login_codes (id, email, code_hash, link_hash, created_at, expires_at, invitation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, email, hashCode(id, code), hashLink(linkToken), now(), expiresAt, joining ? invitation.id : null)
  const candidateLocale = candidate?.locale === 'es' || candidate?.locale === 'en' ? candidate.locale : null
  const letter = { to: email, code, link: signInLink(linkToken), locale: candidateLocale ?? locale, idempotencyKey: id }
  return { sent: true, deliver: () => sendLoginCode(letter) }
}

interface LoginCodeRow {
  id: string
  code_hash: string
  attempts: number
  expires_at: string
  invitation_id: string | null
}

export type CodeCheck =
  | { ok: true; candidate: CandidateRow; joined: boolean }
  | { ok: false; reason: 'wrong' | 'expired' | 'invitation_used' | 'beta_full' }

export function verifyLoginCode(email: string, code: string, locale: Locale): CodeCheck {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT id, code_hash, attempts, expires_at, invitation_id FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
    )
    .get(email) as LoginCodeRow | undefined
  if (!row || row.expires_at < now() || row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'expired' }

  const given = Buffer.from(hashCode(row.id, code.replace(/\D/g, '')), 'hex')
  const expected = Buffer.from(row.code_hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
    return { ok: false, reason: row.attempts + 1 >= MAX_ATTEMPTS ? 'expired' : 'wrong' }
  }

  return spend(row, email, locale)
}

// A code or link that worked is spent, with its twin: then the account, or a
// new one if it came from an invitation.
function spend(row: { id: string; invitation_id: string | null }, email: string, locale: Locale): CodeCheck {
  getDb().prepare('UPDATE login_codes SET used_at = ? WHERE id = ?').run(now(), row.id)
  const candidate = getCandidateByEmail(email)
  if (candidate) return { ok: true, candidate, joined: false }
  if (!row.invitation_id) return { ok: false, reason: 'expired' }
  return createAccount(email, row.invitation_id, locale)
}

interface LinkRow {
  id: string
  email: string
  invitation_id: string | null
}

function openLink(token: string): LinkRow | undefined {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined
  return getDb()
    .prepare('SELECT id, email, invitation_id FROM login_codes WHERE link_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?')
    .get(hashLink(token), now(), MAX_ATTEMPTS) as LinkRow | undefined
}

// Who a link would sign in, without spending it: the page it opens asks
// before signing in, because mail scanners open links on their own.
export function peekLoginLink(token: string): string | null {
  return openLink(token)?.email ?? null
}

export function verifyLoginLink(token: string, locale: Locale): CodeCheck {
  const row = openLink(token)
  if (!row) return { ok: false, reason: 'expired' }
  return spend(row, row.email, locale)
}

// The account and the used invitation are one step: if the invitation was
// taken meanwhile, or the beta filled up, no account is left behind.
function createAccount(email: string, invitationId: string, locale: Locale): CodeCheck {
  const db = getDb()
  const invitation = getInvitation(invitationId)
  if (!invitation || invitation.accepted_at) return { ok: false, reason: 'invitation_used' }
  if (betaIsFull()) return { ok: false, reason: 'beta_full' }
  const id = newId('cand')
  const accepted = inTransaction(() => {
    db.prepare(
      "INSERT INTO candidates (id, created_at, email, role, locale, locale_source) VALUES (?, ?, ?, 'member', ?, 'detected')",
    ).run(id, now(), email, locale)
    if (acceptInvitation(invitationId, id)) return true
    db.prepare('DELETE FROM candidates WHERE id = ?').run(id)
    return false
  })
  if (!accepted) return { ok: false, reason: 'invitation_used' }
  const candidate = getCandidateByEmail(email)
  return candidate ? { ok: true, candidate, joined: true } : { ok: false, reason: 'expired' }
}
