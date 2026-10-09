import { randomBytes } from 'node:crypto'
import { getDb } from '../db/db'
import { now } from '../db/repo'
import { startLink as botLink, telegramConfig } from './api'

// Someone connects Telegram from the app: a link opens amble's bot with a
// one-time code, and tapping «Start» sends it back. Starting the chat is
// their consent to be written to; the code ties the chat to their account.
// Telegram lets a start code be letters, digits, _ and -, 64 at most.

const CODE_MINUTES = 30

export interface TelegramLink {
  candidate_id: string
  chat_id: string
  user_id: string | null
  username: string | null
  linked_at: string
  last_inbound_at: string | null
}

export function telegramLinkOf(candidateId: string): TelegramLink | null {
  return (getDb().prepare('SELECT * FROM telegram_links WHERE candidate_id = ?').get(candidateId) as TelegramLink | undefined) ?? null
}

export function telegramLinkByChat(chatId: string): TelegramLink | null {
  return (getDb().prepare('SELECT * FROM telegram_links WHERE chat_id = ?').get(chatId) as TelegramLink | undefined) ?? null
}

// The link that opens the bot with their code, or null without a bot.
export function startTelegramLink(candidateId: string): { url: string } | null {
  const config = telegramConfig()
  if (!config) return null
  const db = getDb()
  db.prepare('DELETE FROM telegram_link_codes WHERE candidate_id = ? OR expires_at < ?').run(candidateId, now())
  // 24 random characters: guessing one is hopeless.
  const code = randomBytes(18).toString('base64url')
  db.prepare('INSERT INTO telegram_link_codes (code, candidate_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    code,
    candidateId,
    now(),
    new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  )
  return { url: botLink(config, code) }
}

// "/start <code>" as the bot receives it: whose code it is, still valid. Used once.
export function takeStartCode(text: string): string | null {
  const code = text.match(/^\/start\s+([A-Za-z0-9_-]{8,64})\s*$/)?.[1]
  if (!code) return null
  const db = getDb()
  const row = db.prepare('SELECT candidate_id FROM telegram_link_codes WHERE code = ? AND expires_at >= ?').get(code, now()) as { candidate_id: string } | undefined
  if (!row) return null
  db.prepare('DELETE FROM telegram_link_codes WHERE code = ?').run(code)
  return row.candidate_id
}

export function saveTelegramLink(candidateId: string, chat: { chatId: string; userId: string | null; username: string | null }): void {
  const db = getDb()
  // A chat belongs to one account: connecting it here disconnects it elsewhere.
  db.prepare('DELETE FROM telegram_links WHERE chat_id = ? AND candidate_id != ?').run(chat.chatId, candidateId)
  db.prepare(
    `INSERT INTO telegram_links (candidate_id, chat_id, user_id, username, linked_at, last_inbound_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(candidate_id) DO UPDATE SET chat_id = excluded.chat_id, user_id = excluded.user_id, username = excluded.username,
       linked_at = excluded.linked_at, last_inbound_at = excluded.last_inbound_at`,
  ).run(candidateId, chat.chatId, chat.userId, chat.username, now(), now())
}

export function touchTelegramLink(candidateId: string): void {
  getDb().prepare('UPDATE telegram_links SET last_inbound_at = ? WHERE candidate_id = ?').run(now(), candidateId)
}

export function unlinkTelegram(candidateId: string): void {
  getDb().prepare('DELETE FROM telegram_links WHERE candidate_id = ?').run(candidateId)
}
