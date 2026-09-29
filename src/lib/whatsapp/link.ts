import { randomInt } from 'node:crypto'
import { getDb } from '../db/db'
import { now } from '../db/repo'
import { chatLink, zernioConfig } from './zernio'

// A person links their WhatsApp by writing to amble first, from the app, with
// a message already written that carries a short code. Writing first is their
// consent to be written to, proves the number is theirs for free, and opens
// the 24 hours in which amble can answer.

const CODE_MINUTES = 30

export interface WhatsAppLink {
  candidate_id: string
  phone: string
  user_id: string | null
  conversation_id: string | null
  linked_at: string
  last_inbound_at: string | null
}

export function linkOf(candidateId: string): WhatsAppLink | null {
  return (getDb().prepare('SELECT * FROM whatsapp_links WHERE candidate_id = ?').get(candidateId) as WhatsAppLink | undefined) ?? null
}

// Who wrote, by WhatsApp's own id for them when it comes, else by number.
export function linkBySender(sender: { userId: string | null; phone: string | null }): WhatsAppLink | null {
  const db = getDb()
  if (sender.userId) {
    const row = db.prepare('SELECT * FROM whatsapp_links WHERE user_id = ?').get(sender.userId) as WhatsAppLink | undefined
    if (row) return row
  }
  if (sender.phone) return (db.prepare('SELECT * FROM whatsapp_links WHERE phone = ?').get(sender.phone) as WhatsAppLink | undefined) ?? null
  return null
}

// The message they send to link it, and the link that opens WhatsApp with it.
export function startLink(candidateId: string, text: (code: string) => string): { url: string; code: string } | null {
  const config = zernioConfig()
  if (!config) return null
  const db = getDb()
  db.prepare('DELETE FROM whatsapp_link_codes WHERE candidate_id = ? OR expires_at < ?').run(candidateId, now())
  let code = ''
  for (let tries = 0; tries < 5; tries++) {
    code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    if (!db.prepare('SELECT 1 FROM whatsapp_link_codes WHERE code = ?').get(code)) break
  }
  db.prepare('INSERT INTO whatsapp_link_codes (code, candidate_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    code,
    candidateId,
    now(),
    new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  )
  return { url: chatLink(config, text(code)), code }
}

// A code found in what someone wrote, still valid: whose it is. Used once.
export function takeLinkCode(text: string): string | null {
  const db = getDb()
  for (const match of text.matchAll(/\b(\d{6})\b/g)) {
    const row = db.prepare('SELECT candidate_id FROM whatsapp_link_codes WHERE code = ? AND expires_at >= ?').get(match[1], now()) as
      | { candidate_id: string }
      | undefined
    if (row) {
      db.prepare('DELETE FROM whatsapp_link_codes WHERE code = ?').run(match[1])
      return row.candidate_id
    }
  }
  return null
}

export function saveLink(candidateId: string, params: { phone: string; userId: string | null; conversationId: string }): void {
  const db = getDb()
  // A number belongs to one account: linking it here unlinks it elsewhere.
  db.prepare('DELETE FROM whatsapp_links WHERE (phone = ? OR (user_id IS NOT NULL AND user_id = ?)) AND candidate_id != ?').run(
    params.phone,
    params.userId,
    candidateId,
  )
  db.prepare(
    `INSERT INTO whatsapp_links (candidate_id, phone, user_id, conversation_id, linked_at, last_inbound_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(candidate_id) DO UPDATE SET phone = excluded.phone, user_id = excluded.user_id,
       conversation_id = excluded.conversation_id, linked_at = excluded.linked_at, last_inbound_at = excluded.last_inbound_at`,
  ).run(candidateId, params.phone, params.userId, params.conversationId, now(), now())
}

export function touchLink(candidateId: string, conversationId: string): void {
  getDb().prepare('UPDATE whatsapp_links SET last_inbound_at = ?, conversation_id = ? WHERE candidate_id = ?').run(now(), conversationId, candidateId)
}

export function unlink(candidateId: string): void {
  getDb().prepare('DELETE FROM whatsapp_links WHERE candidate_id = ?').run(candidateId)
}

// Within 24 hours of their last message, amble can write freely.
export function windowOpen(link: WhatsAppLink): boolean {
  return Boolean(link.last_inbound_at && Date.now() - Date.parse(link.last_inbound_at) < 24 * 60 * 60 * 1000)
}
