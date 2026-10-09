import { getDb } from '../db/db'
import { listWanted, respondToMatch, setProgress } from '../db/matching'
import { now } from '../db/repo'
import { reportedClosed } from '../sourcing/liveness'
import type { AgentAction } from './agent'
import type { FollowupAnswer } from './followups'

// What the agent decided to do, done: an application prepared (offered with
// buttons, as after "interested"), or the news they gave about one kept, as
// if they had marked it in the app. Only on offers they follow or were sent.

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface Known {
  opportunityId: string
  company: string
  followed: boolean
  applied: boolean
}

// The offer they mean, by company: the ones they follow first, then the ones
// sent to them, most recent first.
function findOffer(candidateId: string, company: string): Known | null {
  const wanted = norm(company)
  if (!wanted) return null
  const followed = listWanted(candidateId).map((row) => ({
    opportunityId: row.opportunity_id,
    company: row.company_name,
    followed: true,
    applied: row.progress === 'applied',
  }))
  const sent = (
    getDb()
      .prepare(
        `SELECT s.opportunity_id, c.name AS company FROM offer_sends s JOIN opportunities o ON o.id = s.opportunity_id
         JOIN companies c ON c.id = o.company_id WHERE s.candidate_id = ? AND s.sent_at IS NOT NULL ORDER BY s.sent_at DESC`,
      )
      .all(candidateId) as unknown as { opportunity_id: string; company: string }[]
  ).map((row) => ({ opportunityId: row.opportunity_id, company: row.company, followed: false, applied: false }))
  return [...followed, ...sent].find((item) => norm(item.company).includes(wanted) || wanted.includes(norm(item.company))) ?? null
}

// An offer they say is closed leaves their list now (one they followed is no
// longer followed; one waiting for their answer is a «not for me»), and its
// page is opened: closed there, it closes for everyone.
function offerClosed(candidateId: string, company: string): ActionResult {
  const wanted = norm(company)
  const offer =
    findOffer(candidateId, company) ??
    (wanted
      ? ((
          getDb()
            .prepare(
              `SELECT r.opportunity_id, c.name AS company FROM offer_releases r JOIN opportunities o ON o.id = r.opportunity_id
               JOIN companies c ON c.id = o.company_id WHERE r.candidate_id = ? AND o.closed_at IS NULL ORDER BY r.released_at DESC`,
            )
            .all(candidateId) as unknown as { opportunity_id: string; company: string }[]
        )
          .filter((row) => norm(row.company).includes(wanted) || wanted.includes(norm(row.company)))
          .map((row) => ({ opportunityId: row.opportunity_id, company: row.company, followed: false, applied: false }))[0] ?? null)
      : null)
  if (!offer) return { done: false }
  // One they already applied to stays so: closed to new candidates, theirs goes on.
  if (offer.followed) {
    if (!offer.applied) setProgress(candidateId, [offer.opportunityId], 'dropped')
  } else {
    const matchId = latestMatchId(candidateId, offer.opportunityId)
    if (matchId) respondToMatch(matchId, candidateId, 'not_for_me', 'cerrada')
  }
  void reportedClosed(offer.opportunityId).catch((error) => console.error('[amble] closed offer check failed:', error instanceof Error ? error.message : error))
  return { done: true }
}

function latestMatchId(candidateId: string, opportunityId: string): string | null {
  const row = getDb()
    .prepare('SELECT id FROM opportunity_matches WHERE candidate_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId, opportunityId) as { id: string } | undefined
  return row?.id ?? null
}

// What they said about an application, kept where the follow-up answers are.
const OUTCOME: Partial<Record<string, FollowupAnswer>> = { interview: 'called', offer: 'offer', rejected: 'rejected' }

export interface ActionResult {
  buttons?: { title: string; payload: string }[]
  done: boolean
}

export function runAction(
  candidateId: string,
  action: AgentAction,
  labels: { yes: string; no: string },
): ActionResult {
  // A pasted offer is judged, and a pause or a change to their map or
  // account proposed, in the inbound path, not here.
  if (action.type === 'offer_closed') return offerClosed(candidateId, action.company)
  if (action.type !== 'prepare_application' && action.type !== 'application_update') return { done: false }
  const offer = findOffer(candidateId, action.company)
  if (!offer) return { done: false }
  const matchId = latestMatchId(candidateId, offer.opportunityId)

  if (action.type === 'prepare_application') {
    // Already sent: nothing to prepare.
    if (!matchId || offer.applied) return { done: false }
    return {
      done: true,
      buttons: [
        { title: labels.yes, payload: `ap:${matchId}:yes` },
        { title: labels.no, payload: `ap:${matchId}:no` },
      ],
    }
  }

  // An offer only sent to them becomes one they follow, then applied to.
  if (!offer.followed && matchId) respondToMatch(matchId, candidateId, 'interested', null)
  setProgress(candidateId, [offer.opportunityId], 'applied')
  const outcome = OUTCOME[action.status]
  if (outcome) {
    getDb()
      .prepare(
        `INSERT INTO application_followups (candidate_id, opportunity_id, round, asked_at, answer, answered_at) VALUES (?, ?, 0, ?, ?, ?)
         ON CONFLICT (candidate_id, opportunity_id, round) DO UPDATE SET answer = excluded.answer, answered_at = excluded.answered_at`,
      )
      .run(candidateId, offer.opportunityId, now(), outcome, now())
  }
  return { done: true }
}
