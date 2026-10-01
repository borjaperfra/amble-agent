import { randomBytes } from 'node:crypto'
import { getDb } from '../db/db'
import { newId, now } from '../db/repo'

// The beta is by invitation (modelled on instinct.com): a link creates one
// account. Each member has INVITES_PER_MEMBER to give; the owner issues as
// many as needed. There is no queue position or referral reward: an
// invitation is a way in, nothing more.

export const INVITES_PER_MEMBER = 5

export interface InvitationRow {
  id: string
  token: string
  inviter_id: string | null
  created_at: string
  accepted_by: string | null
  accepted_at: string | null
}

// Accounts the beta takes, if a limit is set. When it is reached, an
// invitation no longer opens the door: its holder joins the waitlist.
export function betaCapacity(): number | null {
  const value = Number(process.env.AMBLE_BETA_CAPACITY)
  return Number.isInteger(value) && value > 0 ? value : null
}

export function betaIsFull(): boolean {
  const capacity = betaCapacity()
  if (capacity === null) return false
  const accounts = getDb().prepare('SELECT COUNT(*) AS n FROM candidates WHERE email IS NOT NULL').get() as { n: number }
  return accounts.n >= capacity
}

function insertInvitation(inviterId: string | null): InvitationRow {
  const row: InvitationRow = {
    id: newId('inv'),
    token: randomBytes(16).toString('base64url'),
    inviter_id: inviterId,
    created_at: now(),
    accepted_by: null,
    accepted_at: null,
  }
  getDb()
    .prepare('INSERT INTO invitations (id, token, inviter_id, created_at) VALUES (?, ?, ?, ?)')
    .run(row.id, row.token, row.inviter_id, row.created_at)
  return row
}

// Invitations from Amble itself (inviterId null), for the beta email, or from a candidate.
export function issueInvitations(inviterId: string | null, count: number): InvitationRow[] {
  return Array.from({ length: count }, () => insertInvitation(inviterId))
}

// A member's invitations: always INVITES_PER_MEMBER in all, given or not.
export function invitationsOf(candidateId: string): InvitationRow[] {
  const db = getDb()
  const existing = () =>
    db.prepare('SELECT * FROM invitations WHERE inviter_id = ? ORDER BY created_at ASC').all(candidateId) as unknown as InvitationRow[]
  const missing = INVITES_PER_MEMBER - existing().length
  for (let i = 0; i < missing; i++) insertInvitation(candidateId)
  return existing()
}

// An invitation that can still create an account.
export function openInvitation(token: string): InvitationRow | null {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const row = getDb().prepare('SELECT * FROM invitations WHERE token = ?').get(token) as unknown as InvitationRow | undefined
  return row && !row.accepted_at ? row : null
}

export function getInvitation(id: string): InvitationRow | undefined {
  return getDb().prepare('SELECT * FROM invitations WHERE id = ?').get(id) as unknown as InvitationRow | undefined
}

// Only one account per invitation, even if two people use the link at once.
export function acceptInvitation(invitationId: string, candidateId: string): boolean {
  const result = getDb()
    .prepare('UPDATE invitations SET accepted_by = ?, accepted_at = ? WHERE id = ? AND accepted_at IS NULL')
    .run(candidateId, now(), invitationId)
  return Number(result.changes) > 0
}

export function invitationLink(token: string): string {
  const base = (process.env.AMBLE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/join/${token}`
}
