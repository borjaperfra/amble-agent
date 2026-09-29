import { getDb } from '../db/db'
import { newId, now } from '../db/repo'

// What was said on WhatsApp, both ways, in order.

export type Direction = 'in' | 'out'

export function logMessage(candidateId: string, direction: Direction, body: string): void {
  if (!body.trim()) return
  getDb()
    .prepare('INSERT INTO whatsapp_messages (id, candidate_id, direction, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId('wam'), candidateId, direction, body.slice(0, 4000), now())
}

// The latest exchanges, oldest first: the agent's short memory.
export function recentMessages(candidateId: string, limit = 20): { direction: Direction; body: string; at: string }[] {
  const rows = getDb()
    .prepare('SELECT direction, body, created_at AS at FROM whatsapp_messages WHERE candidate_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(candidateId, limit) as unknown as { direction: Direction; body: string; at: string }[]
  return rows.reverse()
}
