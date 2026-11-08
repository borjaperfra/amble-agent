import { getDb } from '../db/db'
import { candidateById, isSearchPaused, now } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { reachableCandidateIds, reachOf } from '../channel/reach'
import { logMessage } from './conversation'
import { wroteFirstRecently } from './proactive'

// An offer they said interested them, still not sent days later: «Preferiría
// una gestión más activa de mi candidatura» (05-11). A Rep that carries the
// process asks once whether to prepare it, with the buttons that do it:
// prepare it, I sent it already, not now. Once per offer, the oldest first,
// never on a day amble already wrote first; an offer closed since is not
// asked about.

const WAIT_MS = 3 * 24 * 60 * 60 * 1000

interface Waiting {
  opportunity_id: string
  title: string
  company: string
  match_id: string | null
}

export function oldestUnsent(candidateId: string, at = Date.now()): Waiting | null {
  return (
    (getDb()
      .prepare(
        `SELECT d.opportunity_id, o.title, c.name AS company,
                (SELECT m.id FROM opportunity_matches m WHERE m.candidate_id = d.candidate_id AND m.opportunity_id = d.opportunity_id ORDER BY m.created_at DESC LIMIT 1) AS match_id
         FROM opportunity_decisions d JOIN opportunities o ON o.id = d.opportunity_id JOIN companies c ON c.id = o.company_id
         WHERE d.candidate_id = ? AND d.decision IN ('interested', 'wanted_anyway') AND d.progress IS NULL AND o.closed_at IS NULL
           AND d.nudged_at IS NULL AND d.decided_at <= ?
         ORDER BY d.decided_at ASC LIMIT 1`,
      )
      .get(candidateId, new Date(at - WAIT_MS).toISOString()) as Waiting | undefined) ?? null
  )
}

export async function sendDueWantedNudges(): Promise<{ asked: number }> {
  let asked = 0
  for (const candidateId of reachableCandidateIds()) {
    const reach = reachOf(candidateId)
    // Outside WhatsApp's 24 hours it would need a template of its own: not yet.
    if (!reach || !reach.open || isSearchPaused(candidateId) || wroteFirstRecently(candidateId)) continue
    const offer = oldestUnsent(candidateId)
    if (!offer?.match_id) continue
    const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
    const text = w.wantedNudge(offer.title, offer.company)
    await reach.send({
      text,
      buttons: [
        { title: w.applyButtons.yes, payload: `ap:${offer.match_id}:yes` },
        { title: w.offerButtons.applied, payload: `of:${offer.match_id}:applied`, beside: true },
        { title: w.applyButtons.no, payload: `ap:${offer.match_id}:no`, beside: true },
      ],
      idempotencyKey: `wn:${candidateId}:${offer.opportunity_id}`,
    })
    getDb().prepare('UPDATE opportunity_decisions SET nudged_at = ? WHERE candidate_id = ? AND opportunity_id = ?').run(now(), candidateId, offer.opportunity_id)
    logMessage(candidateId, 'out', text)
    asked++
  }
  return { asked }
}
