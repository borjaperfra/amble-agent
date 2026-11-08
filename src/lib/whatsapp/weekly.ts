import { getDb } from '../db/db'
import { candidateById, isSearchPaused, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { reachableCandidateIds, reachOf } from '../channel/reach'
import { logMessage } from './conversation'
import { wroteFirstRecently } from './proactive'

// On Mondays, how their search went last week, when something moved: what
// they sent, what companies answered, what interested them, and what is
// waiting for them to send. «Preferiría una gestión más activa de mi
// candidatura» (05-11): a Rep that carries the process says where it stands.
// Nothing moved, nothing said (VOICE.md: does the person need to hear this
// now?). No model call: everything in it is counted. When something they
// liked waits to be sent, it ends asking whether to prepare it.

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

export interface Week {
  sent: string[]
  called: string[]
  rejected: string[]
  liked: number
  unsent: { title: string; company: string; matchId: string } | null
  unsentCount: number
}

export function weekOf(candidateId: string, at = Date.now()): Week {
  const db = getDb()
  const since = new Date(at - WEEK_MS).toISOString()
  const companies = (sql: string) => (db.prepare(sql).all(candidateId, since) as unknown as { company: string }[]).map((row) => row.company)
  const sent = companies(
    `SELECT DISTINCT c.name AS company FROM opportunity_decisions d JOIN opportunities o ON o.id = d.opportunity_id JOIN companies c ON c.id = o.company_id
     WHERE d.candidate_id = ? AND d.progress = 'applied' AND d.progress_at >= ? ORDER BY d.progress_at`,
  )
  const answered = (answer: string) =>
    companies(
      `SELECT DISTINCT c.name AS company FROM application_followups f JOIN opportunities o ON o.id = f.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE f.candidate_id = ? AND f.answered_at >= ? AND f.answer = '${answer}'`,
    )
  const liked = (
    db
      .prepare("SELECT COUNT(*) AS n FROM opportunity_decisions WHERE candidate_id = ? AND decision IN ('interested', 'wanted_anyway') AND decided_at >= ?")
      .get(candidateId, since) as { n: number }
  ).n
  const unsentCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM opportunity_decisions d JOIN opportunities o ON o.id = d.opportunity_id
         WHERE d.candidate_id = ? AND d.decision IN ('interested', 'wanted_anyway') AND d.progress IS NULL AND o.closed_at IS NULL`,
      )
      .get(candidateId) as { n: number }
  ).n
  // The one to offer to prepare: the oldest not sent, whether or not it was
  // asked about before (the week's message is not that question again).
  const oldest = db
    .prepare(
      `SELECT o.title, c.name AS company,
              (SELECT m.id FROM opportunity_matches m WHERE m.candidate_id = d.candidate_id AND m.opportunity_id = d.opportunity_id ORDER BY m.created_at DESC LIMIT 1) AS matchId
       FROM opportunity_decisions d JOIN opportunities o ON o.id = d.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE d.candidate_id = ? AND d.decision IN ('interested', 'wanted_anyway') AND d.progress IS NULL AND o.closed_at IS NULL
       ORDER BY d.decided_at ASC LIMIT 1`,
    )
    .get(candidateId) as { title: string; company: string; matchId: string | null } | undefined
  return {
    sent,
    called: answered('called'),
    rejected: answered('rejected'),
    liked,
    unsent: oldest?.matchId ? { title: oldest.title, company: oldest.company, matchId: oldest.matchId } : null,
    unsentCount,
  }
}

export function weekMoved(week: Week): boolean {
  return week.sent.length > 0 || week.called.length > 0 || week.rejected.length > 0 || week.liked > 0
}

export function weekText(week: Week, d: (typeof dictionaries)['es']): string {
  const q = d.whatsapp.weekly
  const lines = [
    week.sent.length > 0 ? q.sent(week.sent) : null,
    ...week.called.map((company) => q.called(company)),
    ...week.rejected.map((company) => q.rejected(company)),
    week.liked > 0 ? q.liked(week.liked) : null,
  ].filter((line): line is string => line !== null)
  return [q.title, lines.map((line) => `• ${line}`).join('\n'), week.unsent ? q.unsent(week.unsentCount, week.unsent.title, week.unsent.company) : null]
    .filter(Boolean)
    .join('\n\n')
}

function isMonday(at = new Date()): boolean {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(at) === 'Monday'
}

// Today is the day of it for them: Monday, not sent in the last six days,
// and something moved.
export function weeklyDueToday(candidateId: string, at = new Date()): boolean {
  if (!isMonday(at)) return false
  const last = (getDb().prepare('SELECT weekly_at FROM candidates WHERE id = ?').get(candidateId) as { weekly_at: string | null } | undefined)?.weekly_at
  if (last && at.getTime() - Date.parse(last) < 6 * DAY_MS) return false
  return weekMoved(weekOf(candidateId, at.getTime()))
}

export async function sendWeeklySummaries(): Promise<{ sent: number }> {
  let sent = 0
  for (const candidateId of reachableCandidateIds()) {
    const reach = reachOf(candidateId)
    // Outside WhatsApp's 24 hours it would need a template of its own: not yet.
    if (!reach || !reach.open || isSearchPaused(candidateId) || wroteFirstRecently(candidateId)) continue
    if (!weeklyDueToday(candidateId)) continue
    const week = weekOf(candidateId)
    const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
    const text = weekText(week, dictionaries[candidateLocale(candidateById(candidateId))])
    await reach.send({
      text,
      buttons: week.unsent
        ? [
            { title: w.applyButtons.yes, payload: `ap:${week.unsent.matchId}:yes` },
            { title: w.applyButtons.no, payload: `ap:${week.unsent.matchId}:no`, beside: true },
          ]
        : undefined,
      idempotencyKey: `wk:${candidateId}:${now().slice(0, 10)}`,
    })
    getDb().prepare('UPDATE candidates SET weekly_at = ? WHERE id = ?').run(now(), candidateId)
    logMessage(candidateId, 'out', text)
    sent++
  }
  return { sent }
}
