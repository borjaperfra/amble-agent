import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getDb } from '../db/db'
import { now } from '../db/repo'
import { telegramLinkByChat } from './link'

// Into the app with Telegram, two ways, both for someone whose chat is
// already connected (#35, #34):
//
// - From a browser: «Entrar con Telegram» opens the bot with a one-time code
//   while the browser keeps a secret in a cookie. In the chat they confirm
//   it is them (someone could send them another's link: the bot says only
//   to confirm what they asked for themselves), and the browser holding the
//   secret is signed in to the account of that chat.
// - Inside Telegram (the Mini App): Telegram signs what it hands the page
//   (initData) with the bot's token; checked here, it says which Telegram
//   account opened it, and so whose chat it is.

const LOGIN_MINUTES = 10
export const LOGIN_PREFIX = 'login_'
// The browser's half: the secret, in a cookie only the server reads.
export const LOGIN_COOKIE = 'amble_tg_login'
// What Telegram signs for the Mini App is good for a day.
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function createLogin(): { code: string; secret: string; expires: Date } {
  const code = randomBytes(18).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + LOGIN_MINUTES * 60 * 1000)
  const db = getDb()
  db.prepare('DELETE FROM telegram_logins WHERE expires_at < ?').run(now())
  db.prepare('INSERT INTO telegram_logins (code_hash, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hash(code),
    hash(secret),
    now(),
    expires.toISOString(),
  )
  return { code, secret, expires }
}

// "/start login_<code>": a code still waiting, or null.
export function loginCodeIn(text: string): string | null {
  const code = text.match(new RegExp(`^/start\\s+${LOGIN_PREFIX}([A-Za-z0-9_-]{24})\\s*$`))?.[1]
  if (!code) return null
  const row = getDb().prepare('SELECT approved_at FROM telegram_logins WHERE code_hash = ? AND expires_at >= ?').get(hash(code), now()) as
    { approved_at: string | null } | undefined
  return row && !row.approved_at ? code : null
}

// Their yes in the chat: the browser that asked becomes theirs. False when
// the code ran out meanwhile.
export function approveLogin(code: string, candidateId: string): boolean {
  const changed = getDb()
    .prepare('UPDATE telegram_logins SET candidate_id = ?, approved_at = ? WHERE code_hash = ? AND expires_at >= ? AND approved_at IS NULL')
    .run(candidateId, now(), hash(code), now()).changes
  return Number(changed) > 0
}

export function refuseLogin(code: string): void {
  getDb().prepare('DELETE FROM telegram_logins WHERE code_hash = ?').run(hash(code))
}

// What the browser holding the secret is told: whose account to open (once),
// still waiting, or nothing to wait for.
export function takeLogin(secret: string): { candidateId: string } | 'pending' | 'gone' {
  const db = getDb()
  const row = db.prepare('SELECT candidate_id, expires_at FROM telegram_logins WHERE secret_hash = ?').get(hash(secret)) as
    { candidate_id: string | null; expires_at: string } | undefined
  if (!row || row.expires_at < now()) return 'gone'
  if (!row.candidate_id) return 'pending'
  db.prepare('DELETE FROM telegram_logins WHERE secret_hash = ?').run(hash(secret))
  return { candidateId: row.candidate_id }
}

// The Mini App's initData, checked as Telegram documents it: the data sorted
// as key=value lines, signed with a key made from the bot's token. Whose
// account it is when the signature holds, it is recent, and their chat is
// connected; else null.
export function candidateFromInitData(initData: string, botToken: string): string | null {
  const params = new URLSearchParams(initData)
  const given = params.get('hash')
  if (!given || !/^[0-9a-f]{64}$/.test(given)) return null
  params.delete('hash')
  const checked = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n')
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', key).update(checked).digest()
  if (!timingSafeEqual(expected, Buffer.from(given, 'hex'))) return null
  const signedAt = Number(params.get('auth_date'))
  if (!Number.isFinite(signedAt) || Date.now() / 1000 - signedAt > INIT_DATA_MAX_AGE_S) return null
  let userId: number | null = null
  try {
    userId = (JSON.parse(params.get('user') ?? 'null') as { id?: number } | null)?.id ?? null
  } catch {
    return null
  }
  if (!userId) return null
  // In a private chat the chat's id is the person's: their link by either.
  const row = getDb().prepare('SELECT candidate_id FROM telegram_links WHERE user_id = ?').get(String(userId)) as { candidate_id: string } | undefined
  return row?.candidate_id ?? telegramLinkByChat(String(userId))?.candidate_id ?? null
}
