import { betaCapacity, betaIsFull, getInvitation, invitationLink, issueInvitations, type InvitationRow } from '../auth/invitations'
import { getDb, inTransaction } from '../db/db'
import { now } from '../db/repo'
import type { Locale } from '../i18n/locale'
import { sendInviteEmail } from './invite-email'
import { listWaitlist, type WaitlistAudience, type WaitlistEntry } from './waitlist'

// Letting people from the site's waitlist into the beta: one invitation from
// amble itself per person, kept here by their address so a second click (or
// a retry) reuses it instead of issuing another; and, if asked, one letter
// with their link.

// One request sends at most this many letters: a slip of the hand stays small.
export const MAX_INVITES_PER_REQUEST = 50

export type WaitlistStatus = 'waiting' | 'link' | 'invited' | 'accepted' | 'joined'

export interface AdminWaitlistEntry {
  email: string
  locale: Locale
  audience: WaitlistAudience
  created_at: string
  status: WaitlistStatus
  invited_at: string | null
  sent_at: string | null
  send_error: string | null
  link: string | null
  // Their account in amble, when one has their address.
  candidate_id: string | null
}

export interface BetaSeats {
  capacity: number | null
  accounts: number
  // Null without a limit.
  remaining: number | null
  full: boolean
}

interface InviteRow {
  email: string
  invitation_id: string
  locale: string
  created_at: string
  sent_at: string | null
  send_error: string | null
  token: string
  accepted_at: string | null
}

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

export function betaSeats(): BetaSeats {
  const capacity = betaCapacity()
  const accounts = (getDb().prepare('SELECT COUNT(*) AS n FROM candidates WHERE email IS NOT NULL').get() as { n: number }).n
  return { capacity, accounts, remaining: capacity === null ? null : Math.max(0, capacity - accounts), full: betaIsFull() }
}

function inviteRows(): Map<string, InviteRow> {
  const rows = getDb()
    .prepare(
      `SELECT w.email, w.invitation_id, w.locale, w.created_at, w.sent_at, w.send_error, i.token, i.accepted_at
       FROM waitlist_invites w JOIN invitations i ON i.id = w.invitation_id`,
    )
    .all() as unknown as InviteRow[]
  return new Map(rows.map((row) => [row.email, row]))
}

function accountsByEmail(): Map<string, string> {
  const rows = getDb().prepare('SELECT id, email FROM candidates WHERE email IS NOT NULL').all() as { id: string; email: string }[]
  return new Map(rows.map((row) => [normalize(row.email), row.id]))
}

function statusOf(invite: InviteRow | undefined, candidateId: string | null): WaitlistStatus {
  if (candidateId) return 'joined'
  if (invite?.accepted_at) return 'accepted'
  if (invite?.sent_at) return 'invited'
  if (invite) return 'link'
  return 'waiting'
}

function withState(entries: WaitlistEntry[]): AdminWaitlistEntry[] {
  const invites = inviteRows()
  const accounts = accountsByEmail()
  return entries.map((entry) => {
    const invite = invites.get(entry.normalized)
    const candidateId = accounts.get(entry.normalized) ?? null
    return {
      email: entry.email,
      locale: entry.locale,
      audience: entry.audience,
      created_at: entry.created_at,
      status: statusOf(invite, candidateId),
      invited_at: invite?.created_at ?? null,
      sent_at: invite?.sent_at ?? null,
      send_error: invite?.send_error ?? null,
      link: invite && !invite.accepted_at ? invitationLink(invite.token) : null,
      candidate_id: candidateId,
    }
  })
}

// The same address can be on both lists (candidates and companies): one row,
// the candidate one first.
function unique(entries: WaitlistEntry[]): WaitlistEntry[] {
  const seen = new Map<string, WaitlistEntry>()
  for (const entry of entries) {
    const known = seen.get(entry.normalized)
    if (!known || (known.audience === 'company' && entry.audience === 'candidate')) seen.set(entry.normalized, entry)
  }
  return [...seen.values()]
}

export async function adminWaitlist(): Promise<AdminWaitlistEntry[]> {
  return withState(unique(await listWaitlist()))
}

// Their invitation, issued once: two requests at once still give one.
function ensureInvitation(entry: WaitlistEntry): { invitation: InvitationRow; sentAt: string | null } {
  return inTransaction(() => {
    const db = getDb()
    const existing = db.prepare('SELECT invitation_id, sent_at FROM waitlist_invites WHERE email = ?').get(entry.normalized) as
      | { invitation_id: string; sent_at: string | null }
      | undefined
    if (existing) {
      const invitation = getInvitation(existing.invitation_id)
      if (invitation) return { invitation, sentAt: existing.sent_at }
    }
    const [invitation] = issueInvitations(null, 1)
    db.prepare(
      `INSERT INTO waitlist_invites (email, invitation_id, locale, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET invitation_id = excluded.invitation_id, sent_at = NULL, send_error = NULL`,
    ).run(entry.normalized, invitation.id, entry.locale, now())
    return { invitation, sentAt: null }
  })
}

export type InviteOutcome = { email: string; result: 'sent' | 'already' | 'link' | 'failed' | 'skipped'; link?: string }

export class InviteRefused extends Error {
  constructor(
    readonly reason: 'full' | 'not_enough_seats' | 'too_many' | 'none',
    readonly remaining: number | null = null,
  ) {
    super(reason)
  }
}

// mode 'email': a letter each, never a second one for the same invitation.
// mode 'link': only the link, for the owner to send themselves.
// Only addresses on the waitlist count, with the language they signed up in;
// who already has an account is skipped.
export async function inviteFromWaitlist(emails: string[], mode: 'email' | 'link'): Promise<InviteOutcome[]> {
  const wanted = new Set(emails.map(normalize))
  if (wanted.size === 0) throw new InviteRefused('none')
  if (wanted.size > MAX_INVITES_PER_REQUEST) throw new InviteRefused('too_many')

  const entries = unique(await listWaitlist()).filter((entry) => wanted.has(entry.normalized))
  const accounts = accountsByEmail()
  const invites = inviteRows()
  const pending = entries.filter((entry) => !accounts.has(entry.normalized))
  // Seats are for people who are not in yet and hold no invitation already.
  const fresh = pending.filter((entry) => !invites.has(entry.normalized)).length
  const seats = betaSeats()
  if (fresh > 0 && seats.full) throw new InviteRefused('full', 0)
  if (seats.remaining !== null && fresh > seats.remaining) throw new InviteRefused('not_enough_seats', seats.remaining)

  const outcomes: InviteOutcome[] = entries
    .filter((entry) => accounts.has(entry.normalized))
    .map((entry) => ({ email: entry.email, result: 'skipped' as const }))

  for (const entry of pending) {
    const { invitation, sentAt } = ensureInvitation(entry)
    const link = invitationLink(invitation.token)
    if (invitation.accepted_at) {
      outcomes.push({ email: entry.email, result: 'skipped' })
      continue
    }
    if (mode === 'link') {
      outcomes.push({ email: entry.email, result: 'link', link })
      continue
    }
    if (sentAt) {
      outcomes.push({ email: entry.email, result: 'already', link })
      continue
    }
    try {
      await sendInviteEmail({ to: entry.email, locale: entry.locale, link, idempotencyKey: `waitlist-invite-${invitation.id}` })
      getDb().prepare('UPDATE waitlist_invites SET sent_at = ?, send_error = NULL WHERE email = ?').run(now(), entry.normalized)
      outcomes.push({ email: entry.email, result: 'sent', link })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'failed'
      getDb().prepare('UPDATE waitlist_invites SET send_error = ? WHERE email = ?').run(message, entry.normalized)
      console.error('[amble] invitation email not sent:', message)
      outcomes.push({ email: entry.email, result: 'failed', link })
    }
  }
  return outcomes
}
