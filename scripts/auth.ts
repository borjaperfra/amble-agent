// Accounts, from the terminal.
//
//   npm run auth -- owner you@example.com   the owner's account signs in with this email
//   npm run auth -- sessions                who is signed in, and until when

import { getDb } from '../src/lib/db/db'
import { setOwnerEmail } from '../src/lib/db/repo'
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
} else {
  throw new Error('Commands: owner <email> | sessions')
}
