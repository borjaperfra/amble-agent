import { getDb } from '../db/db'
import { candidateById, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { logMessage } from './conversation'
import { linkOf, windowOpen } from './link'
import { sendMessage, zernioConfig, ZernioError } from './zernio'

// The only thing amble writes about on WhatsApp: a week after someone sends an
// application, whether they have heard anything, with three answers to tap.
// "Nothing yet" (or no answer) brings the question back once, a week later;
// then it is left alone. At most one question a day for each person, the
// oldest first, so a burst of applications never becomes a burst of messages.

// 'offer' comes only from what they tell the agent, never from a button.
export type FollowupAnswer = 'called' | 'rejected' | 'nothing' | 'offer'
const ANSWERS: ('called' | 'rejected' | 'nothing')[] = ['called', 'rejected', 'nothing']

const DAY_MS = 24 * 60 * 60 * 1000
const FIRST_AFTER_DAYS = 7
const AGAIN_AFTER_DAYS = 7
const LAST_ROUND = 2

// What a button carries back: fu:<opportunity>:<round>:<answer>.
function payload(opportunityId: string, round: number, answer: FollowupAnswer): string {
  return `fu:${opportunityId}:${round}:${answer}`
}

export interface FollowupTap {
  opportunityId: string
  round: number
  answer: FollowupAnswer
}

export function parseFollowupPayload(value: string | null): FollowupTap | null {
  const match = value?.match(/^fu:([\w-]+):(\d+):(called|rejected|nothing)$/)
  return match ? { opportunityId: match[1], round: Number(match[2]), answer: match[3] as FollowupAnswer } : null
}

// Their answer, kept on the question; what to say back.
export function answerFollowup(candidateId: string, tap: FollowupTap): string | null {
  const db = getDb()
  const updated = db
    .prepare('UPDATE application_followups SET answer = ?, answered_at = ? WHERE candidate_id = ? AND opportunity_id = ? AND round = ?')
    .run(tap.answer, now(), candidateId, tap.opportunityId, tap.round)
  if (updated.changes === 0) return null
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  if (tap.answer === 'called') {
    const row = db
      .prepare('SELECT c.name FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.id = ?')
      .get(tap.opportunityId) as { name: string } | undefined
    return w.thanksCalled(row?.name ?? '')
  }
  if (tap.answer === 'rejected') return w.thanksRejected
  return tap.round < LAST_ROUND ? w.thanksNothing : w.thanksNothingLast
}

// The latest answer about each application they sent, for the Sent tab.
export function followupOutcomes(candidateId: string): Map<string, FollowupAnswer> {
  const rows = getDb()
    .prepare(
      `SELECT opportunity_id, answer FROM application_followups
       WHERE candidate_id = ? AND answer IS NOT NULL ORDER BY answered_at ASC`,
    )
    .all(candidateId) as unknown as { opportunity_id: string; answer: FollowupAnswer }[]
  return new Map(rows.map((row) => [row.opportunity_id, row.answer]))
}

interface Due {
  opportunity_id: string
  round: number
  title: string
  company: string
}

// The next question owed to one person, if any.
function nextDue(candidateId: string): Due | null {
  const db = getDb()
  const since = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()
  // A first question, a week after it was sent, for one not asked about yet.
  const first = db
    .prepare(
      `SELECT d.opportunity_id, 1 AS round, o.title, c.name AS company FROM opportunity_decisions d
       JOIN opportunities o ON o.id = d.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE d.candidate_id = ? AND d.progress = 'applied' AND d.progress_at <= ?
         AND NOT EXISTS (SELECT 1 FROM application_followups f WHERE f.candidate_id = d.candidate_id AND f.opportunity_id = d.opportunity_id)
       ORDER BY d.progress_at ASC LIMIT 1`,
    )
    .get(candidateId, since(FIRST_AFTER_DAYS)) as Due | undefined
  if (first) return first
  // Once more, a week after "nothing yet" or no answer at all, and never again.
  const again = db
    .prepare(
      `SELECT f.opportunity_id, f.round + 1 AS round, o.title, c.name AS company FROM application_followups f
       JOIN opportunity_decisions d ON d.candidate_id = f.candidate_id AND d.opportunity_id = f.opportunity_id AND d.progress = 'applied'
       JOIN opportunities o ON o.id = f.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE f.candidate_id = ? AND f.round < ? AND f.asked_at <= ? AND (f.answer IS NULL OR f.answer = 'nothing')
         AND NOT EXISTS (SELECT 1 FROM application_followups g WHERE g.candidate_id = f.candidate_id AND g.opportunity_id = f.opportunity_id AND g.round > f.round)
       ORDER BY f.asked_at ASC LIMIT 1`,
    )
    .get(candidateId, LAST_ROUND, since(AGAIN_AFTER_DAYS)) as Due | undefined
  return again ?? null
}

function askedToday(candidateId: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM application_followups WHERE candidate_id = ? AND asked_at >= ?')
      .get(candidateId, new Date(Date.now() - DAY_MS + 60 * 60 * 1000).toISOString()),
  )
}

export interface FollowupStats {
  asked: number
  skipped: { candidateId: string; reason: string }[]
}

// Once a day: the question owed to each person with WhatsApp linked.
export async function sendDueFollowups(): Promise<FollowupStats> {
  const stats: FollowupStats = { asked: 0, skipped: [] }
  const config = zernioConfig()
  if (!config) return stats
  const candidates = getDb().prepare('SELECT candidate_id FROM whatsapp_links WHERE conversation_id IS NOT NULL').all() as unknown as {
    candidate_id: string
  }[]
  for (const { candidate_id: candidateId } of candidates) {
    const link = linkOf(candidateId)
    if (!link?.conversation_id || askedToday(candidateId)) continue
    const due = nextDue(candidateId)
    if (!due) continue
    const open = windowOpen(link)
    // The shared test number can only write inside the 24 hours; a real one
    // writes a utility message outside them.
    if (!open && config.sandbox) {
      stats.skipped.push({ candidateId, reason: 'window closed on the sandbox number' })
      continue
    }
    const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
    try {
      await sendMessage(config, {
        conversationId: link.conversation_id,
        text: w.ask(due.title, due.company),
        buttons: ANSWERS.map((answer) => ({ title: w.answers[answer], payload: payload(due.opportunity_id, due.round, answer) })),
        utility: !open,
        idempotencyKey: `fu:${candidateId}:${due.opportunity_id}:${due.round}`,
      })
      getDb()
        .prepare('INSERT INTO application_followups (candidate_id, opportunity_id, round, asked_at) VALUES (?, ?, ?, ?)')
        .run(candidateId, due.opportunity_id, due.round, now())
      logMessage(candidateId, 'out', w.ask(due.title, due.company))
      stats.asked++
    } catch (error) {
      stats.skipped.push({ candidateId, reason: error instanceof ZernioError ? `${error.status} ${error.code ?? ''} ${error.message}` : String(error) })
    }
  }
  return stats
}
