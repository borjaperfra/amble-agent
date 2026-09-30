import { getDb } from '../db/db'
import { candidateById, getTurn, isSearchPaused, now } from '../db/repo'
import { refreshDetectedLocale } from '../i18n/candidate'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { refreshDerivedProfile } from '../pipeline/graph'
import { planNextQuestion, takeAnswer } from '../pipeline/interview'
import { logMessage } from './conversation'
import { linkOf, windowOpen } from './link'
import { sendMessage, zernioConfig } from './zernio'

// The interview goes on after the setup, on WhatsApp: one question at a
// time, days apart, never on a day amble already wrote to them. What they
// answer (typed or spoken) is taken into their profile as in the web.

const DAYS_APART = 3
const DAY_MS = 24 * 60 * 60 * 1000

// The question asked on WhatsApp and not answered yet, if any.
export function pendingInterviewQuestion(candidateId: string): { turnId: string; question: string } | null {
  const row = getDb()
    .prepare(
      `SELECT q.turn_id FROM whatsapp_questions q JOIN interview_turns t ON t.id = q.turn_id
       WHERE q.candidate_id = ? AND t.answer IS NULL ORDER BY q.asked_at DESC LIMIT 1`,
    )
    .get(candidateId) as { turn_id: string } | undefined
  const turn = row ? getTurn(row.turn_id) : undefined
  return turn?.question ? { turnId: turn.id, question: turn.question } : null
}

// Their answer to it, kept at once and taken in afterwards.
export function answerInterviewQuestion(candidateId: string, turnId: string, text: string): void {
  takeAnswer(candidateId, turnId, text, async (result) => {
    refreshDetectedLocale(candidateId)
    if (result.profileNeedsRefresh) await refreshDerivedProfile(candidateId)
  })
}

function wroteToday(candidateId: string): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT 1 FROM whatsapp_messages WHERE candidate_id = ? AND direction = 'out' AND created_at >= ?")
      .get(candidateId, new Date(Date.now() - DAY_MS / 2).toISOString()),
  )
}

export async function sendDueInterviewQuestions(): Promise<{ asked: number; skipped: number }> {
  const stats = { asked: 0, skipped: 0 }
  const config = zernioConfig()
  if (!config) return stats
  const db = getDb()
  const candidates = db.prepare('SELECT candidate_id FROM whatsapp_links WHERE conversation_id IS NOT NULL').all() as unknown as { candidate_id: string }[]
  for (const { candidate_id: candidateId } of candidates) {
    const link = linkOf(candidateId)
    // Paused: amble does not write first until they resume it.
    if (!link?.conversation_id || isSearchPaused(candidateId)) continue
    // The setup's questions first, in the web; one waiting here is enough.
    const setupDone = db.prepare("SELECT 1 FROM interviews WHERE candidate_id = ? AND status = 'completed'").get(candidateId)
    if (!setupDone || pendingInterviewQuestion(candidateId) || wroteToday(candidateId)) continue
    const last = db.prepare('SELECT MAX(asked_at) AS at FROM whatsapp_questions WHERE candidate_id = ?').get(candidateId) as { at: string | null }
    if (last.at && Date.now() - Date.parse(last.at) < DAYS_APART * DAY_MS) continue
    const open = windowOpen(link)
    if (!open && config.sandbox) {
      stats.skipped++
      continue
    }
    try {
      const next = await planNextQuestion(candidateId, { setup: false })
      if (next.action !== 'ASK' || !next.turnId || !next.question) continue
      const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
      const text = w.interviewQuestion(next.question)
      await sendMessage(config, { conversationId: link.conversation_id, text, utility: !open, idempotencyKey: `iq:${next.turnId}` })
      db.prepare('INSERT INTO whatsapp_questions (candidate_id, turn_id, asked_at) VALUES (?, ?, ?)').run(candidateId, next.turnId, now())
      logMessage(candidateId, 'out', text)
      stats.asked++
    } catch {
      stats.skipped++
    }
  }
  return stats
}
