// Accounts, from the terminal.
//
//   npm run auth -- owner you@example.com   the owner's account signs in with this email
//   npm run auth -- sessions                who is signed in, and until when
//   npm run auth -- invite [n]              n new invitation links from Amble itself (default 1),
//                                           for the beta email: not counted among the owner's own
//   npm run auth -- invites                 every invitation, and whether it was used

import { getDb } from '../src/lib/db/db'
import { setOwnerEmail } from '../src/lib/db/repo'
import { invitationLink, issueInvitations } from '../src/lib/auth/invitations'
import { normaliseEmail } from '../src/lib/auth/codes'

const [command, arg] = process.argv.slice(2)

if (command === 'owner') {
  const email = normaliseEmail(arg)
  if (!email) throw new Error('Usage: npm run auth -- owner you@example.com')
  const owner = setOwnerEmail(email)
  console.log(`${owner.id} (${owner.name ?? 'no name'}) signs in as ${owner.email}, role ${owner.role}.`)
} else if (command === 'sessions') {
  const rows = getDb()
    .prepare(
      `SELECT c.email, s.created_at, s.last_seen_at, s.expires_at FROM sessions s JOIN candidates c ON c.id = s.candidate_id
       WHERE s.expires_at > ? ORDER BY s.last_seen_at DESC`,
    )
    .all(new Date().toISOString())
  console.table(rows)
} else if (command === 'invite') {
  const count = arg === undefined ? 1 : Number(arg)
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Usage: npm run auth -- invite [1-500]')
  for (const invitation of issueInvitations(null, count)) console.log(invitationLink(invitation.token))
} else if (command === 'invites') {
  const rows = getDb()
    .prepare(
      `SELECT i.created_at, inviter.email AS inviter, i.accepted_at, accepted.email AS accepted_by FROM invitations i
       LEFT JOIN candidates inviter ON inviter.id = i.inviter_id LEFT JOIN candidates accepted ON accepted.id = i.accepted_by
       ORDER BY i.created_at`,
    )
    .all()
  console.table(rows)
} else {
  throw new Error('Commands: owner <email> | sessions | invite [n] | invites')
}
