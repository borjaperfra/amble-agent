import { getDb } from '../db/db'
import { candidateById, getRevealedPreference, isSearchPaused, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { requestReread } from '../matching/run'
import { keepRule, removeRule } from '../pipeline/rules'
import { reachableCandidateIds, reachOf } from '../channel/reach'
import { logMessage } from './conversation'
import { wroteFirstRecently } from './proactive'

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

// A rule amble proposed from a «no» they gave an offer in the app, waiting
// for their yes on /me/preferences, where nobody goes back to look: on
// 2026-11-08, 14 such proposals from 9 people had waited more than two days,
// the oldest since 07-10. What they said is not kept until they say yes, so
// it is asked once on the chat, a day after it was proposed, with its
// buttons: yes, for every offer; or only that one. Once, and never on a day
// amble already wrote first.

const WAIT_MS = 24 * 60 * 60 * 1000
const QUOTE_CHARS = 160

interface Waiting {
  id: string
  label: string | null
  statement: string
  quote: string | null
}

function oldestWaiting(candidateId: string): Waiting | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, label, statement, quote FROM revealed_preferences
         WHERE candidate_id = ? AND status = 'proposed' AND source = 'offer' AND triage_id IS NULL AND asked_at IS NULL AND created_at <= ?
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(candidateId, new Date(Date.now() - WAIT_MS).toISOString()) as Waiting | undefined) ?? null
  )
}

export async function sendDueRuleQuestions(): Promise<{ asked: number }> {
  let asked = 0
  for (const candidateId of reachableCandidateIds()) {
    const reach = reachOf(candidateId)
    // Outside WhatsApp's 24 hours it would need a template of its own: not yet.
    if (!reach || !reach.open || isSearchPaused(candidateId) || wroteFirstRecently(candidateId)) continue
    const rule = oldestWaiting(candidateId)
    if (!rule) continue
    const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
    const quote = rule.quote ? (rule.quote.length > QUOTE_CHARS ? `${rule.quote.slice(0, QUOTE_CHARS - 1).trimEnd()}…` : rule.quote) : null
    const text = w.ruleAsk(rule.label ?? rule.statement, quote)
    await reach.send({
      text,
      buttons: [
        { title: w.noRuleButtons.yes, payload: `pp:${rule.id}:yes` },
        { title: w.noRuleButtons.no, payload: `pp:${rule.id}:no`, beside: true },
      ],
      idempotencyKey: `pp:${rule.id}`,
    })
    getDb().prepare('UPDATE revealed_preferences SET asked_at = ? WHERE id = ?').run(now(), rule.id)
    logMessage(candidateId, 'out', text)
    asked++
  }
  return { asked }
}

export function parseRuleAskPayload(value: string | null): { id: string; answer: 'yes' | 'no' } | null {
  const match = value?.match(/^pp:([\w-]+):(yes|no)$/)
  return match ? { id: match[1], answer: match[2] as 'yes' | 'no' } : null
}

// Their answer: the rule holds for every offer, or it was only that one.
export async function answerRuleAsk(candidateId: string, tap: { id: string; answer: 'yes' | 'no' }, reply: Reply): Promise<void> {
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const row = getRevealedPreference(tap.id)
  // Decided since, on the screen or before: nothing left to answer.
  if (!row || row.candidate_id !== candidateId || row.status !== 'proposed') {
    await reply(w.preferenceExpired)
    return
  }
  if (tap.answer === 'no') {
    removeRule(candidateId, row.id)
    await reply(w.ruleAskOnlyThat)
    return
  }
  keepRule(candidateId, row.id)
  // What was read lately is read again with it, in the background.
  requestReread(candidateId)
  await reply(w.preferenceSaved(row.label ?? row.statement))
}
