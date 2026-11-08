import { getDb } from '../db/db'
import { candidateById, isSearchPaused, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { getOpportunitiesView, type Drought } from '../matching/view'
import { reachOf } from '../channel/reach'
import { logMessage } from './conversation'
import { appUrl } from './offers'
import { wroteFirstRecently } from './proactive'

// When the chat has been quiet (#51): «No me localiza ninguna propuesta
// interesante» (05-11), from someone with 62 offers waiting in the app.
// Silence reads as amble not looking. After QUIET_DAYS without an offer on
// the chat, once a week at most, it says why, from what it read (the same
// reasons the app's drought note gives), how many wait in the app, and asks
// the one question that could open the search where it is closed most. What
// they answer goes to the agent, which proposes a change to their rules on
// their yes. No model call here: everything said is counted.

export const QUIET_DAYS = 4
const NOTE_EVERY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

type Reason = Drought['reasons'][number]

// Since when the chat has had nothing for them: the last offer sent, or the
// day the chat was connected.
function quietSince(candidateId: string): string | null {
  const db = getDb()
  const sent = (db.prepare('SELECT MAX(sent_at) AS at FROM offer_sends WHERE candidate_id = ? AND sent_at IS NOT NULL').get(candidateId) as { at: string | null }).at
  if (sent) return sent
  const linked = db
    .prepare('SELECT MAX(at) AS at FROM (SELECT linked_at AS at FROM whatsapp_links WHERE candidate_id = ? UNION ALL SELECT linked_at AS at FROM telegram_links WHERE candidate_id = ?)')
    .get(candidateId, candidateId) as { at: string | null }
  return linked.at
}

export function quietNoteDue(candidateId: string, at = Date.now()): { days: number } | null {
  const since = quietSince(candidateId)
  if (!since) return null
  const days = Math.floor((at - Date.parse(since)) / DAY_MS)
  if (days < QUIET_DAYS) return null
  const row = getDb().prepare('SELECT quiet_note_at, quiet_checked_at FROM candidates WHERE id = ?').get(candidateId) as
    | { quiet_note_at: string | null; quiet_checked_at: string | null }
    | undefined
  if (row?.quiet_note_at && at - Date.parse(row.quiet_note_at) < NOTE_EVERY_DAYS * DAY_MS) return null
  // Looked at today and nothing was worth saying: not looked at again until tomorrow.
  if (row?.quiet_checked_at && at - Date.parse(row.quiet_checked_at) < DAY_MS) return null
  return { days }
}

// The note, from the facts: what set most offers aside, what waits in the
// app, and the question that fits that reason. Null when there is nothing
// worth saying (nothing read, nothing waiting): then silence is right.
export function quietNoteText(
  facts: { days: number; reason: Reason | null; waiting: number; link: string },
  d: (typeof dictionaries)['es'],
): string | null {
  const q = d.whatsapp.quiet
  if (!facts.reason && facts.waiting === 0) return null
  const reason = facts.reason
  const why = reason
    ? reason.kind === 'rule' && reason.rule
      ? q.whyRule(reason.rule)
      : q.why[reason.kind as keyof typeof q.why] ?? null
    : null
  const ask = reason
    ? reason.kind === 'rule' && reason.rule
      ? q.askRule(reason.rule)
      : q.ask[reason.kind as keyof typeof q.ask] ?? q.askAny
    : q.askAny
  // Why, then what waits (a link ends its line), then the question, on its own.
  return [[q.opening(facts.days), why].filter(Boolean).join(' '), facts.waiting > 0 ? q.waiting(facts.waiting, facts.link) : null, ask].filter(Boolean).join('\n\n')
}

// For one person, when it is due: sent, kept, and counted as amble writing
// first today (proactive.ts). True when it went.
export async function sendQuietNote(candidateId: string): Promise<boolean> {
  const reach = reachOf(candidateId)
  // Outside WhatsApp's 24 hours it would need a template of its own: not yet.
  if (!reach || !reach.open || isSearchPaused(candidateId) || wroteFirstRecently(candidateId)) return false
  const due = quietNoteDue(candidateId)
  if (!due) return false
  const view = getOpportunitiesView(candidateId)
  // What set most aside, as the app's drought note counts it; what could not
  // be read is no reason to change what they look for.
  const reason = view.drought?.reasons.find((item) => item.kind !== 'unread') ?? null
  const waiting = [...view.found, ...view.maybe].filter((item) => item.response === null && !item.closed).length
  const d = dictionaries[candidateLocale(candidateById(candidateId))]
  const text = quietNoteText({ days: due.days, reason, waiting, link: appUrl(candidateId, '/opportunities?tab=new') }, d)
  getDb().prepare('UPDATE candidates SET quiet_checked_at = ? WHERE id = ?').run(now(), candidateId)
  if (!text) return false
  await reach.send({ text, idempotencyKey: `quiet:${candidateId}:${now().slice(0, 10)}` })
  getDb().prepare('UPDATE candidates SET quiet_note_at = ? WHERE id = ?').run(now(), candidateId)
  logMessage(candidateId, 'out', text)
  return true
}
