import { createHash, randomBytes } from 'node:crypto'
import { getDb } from '../db/db'
import { now } from '../db/repo'

// Links amble sends someone on WhatsApp (an offer to finish applying to,
// what to change in the app) open their own account, signed in, wherever
// they tap them. Not single-use: WhatsApp itself opens a link to draw its
// preview, which would spend it. They last two days, go nowhere else, and
// never switch the account of someone already signed in.

const DAYS = 2

function hash(token: string): string {
  return createHash('sha256').update(`app:${token}`).digest('hex')
}

export function appBase(): string {
  return (process.env.AMBLE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

export function issueAppLink(candidateId: string, route: string): string {
  const token = randomBytes(24).toString('base64url')
  getDb().prepare('DELETE FROM app_links WHERE expires_at <= ?').run(now())
  getDb()
    .prepare('INSERT INTO app_links (token_hash, candidate_id, route, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(hash(token), candidateId, route.startsWith('/') ? route : '/', now(), new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000).toISOString())
  return `${appBase()}/go/${token}`
}

export function openAppLink(token: string): { candidateId: string; route: string } | null {
  const row = getDb().prepare('SELECT candidate_id, route FROM app_links WHERE token_hash = ? AND expires_at > ?').get(hash(token), now()) as
    | { candidate_id: string; route: string }
    | undefined
  return row ? { candidateId: row.candidate_id, route: row.route } : null
}
