import { chatAppsOf } from '../channel/reach'
import { startTelegramLink } from '../telegram/link'
import { startLink } from './link'
import { getDb } from '../db/db'
import { listWanted, respondToMatch, setProgress } from '../db/matching'
import { now } from '../db/repo'
import { reportedClosed } from '../sourcing/liveness'
import { aYearFromNow, excludeCompany, findTheirCompany, includeCompany, listExcludedCompanies } from '../db/excluded-companies'
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

// The offer they ask to see, among those amble gave them (waiting in the
// app, sent, or followed), most recent first: by company, and by title when
// that company has more than one.
export function offerToShow(candidateId: string, company: string, title: string | null): string | null {
  const wanted = norm(company)
  if (!wanted) return null
  const rows = getDb()
    .prepare(
      `SELECT o.id AS opportunity_id, o.title, c.name AS company, MAX(x.at) AS at FROM (
         SELECT opportunity_id, released_at AS at FROM offer_releases WHERE candidate_id = ?
         UNION ALL SELECT opportunity_id, sent_at AS at FROM offer_sends WHERE candidate_id = ? AND sent_at IS NOT NULL
         UNION ALL SELECT opportunity_id, decided_at AS at FROM opportunity_decisions WHERE candidate_id = ?
       ) x JOIN opportunities o ON o.id = x.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE o.closed_at IS NULL GROUP BY o.id ORDER BY at DESC`,
    )
    .all(candidateId, candidateId, candidateId) as unknown as { opportunity_id: string; title: string; company: string }[]
  const atCompany = rows.filter((row) => norm(row.company).includes(wanted) || wanted.includes(norm(row.company)))
  const titled = title ? atCompany.filter((row) => norm(row.title).includes(norm(title)) || norm(title).includes(norm(row.title))) : []
  return (titled[0] ?? atCompany[0])?.opportunity_id ?? null
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

// A company they want nothing from, or one let back in (#44): the name they
// gave, found among the companies whose offers amble judged for them. Null
// when nothing of theirs is called that, so the reply can say so.
export function companyAction(
  candidateId: string,
  action: { type: 'exclude_company'; company: string; forAYear: boolean } | { type: 'include_company'; company: string },
): { company: string; until: string | null } | null {
  if (action.type === 'include_company') {
    const wanted = norm(action.company)
    const row = listExcludedCompanies(candidateId).find((item) => norm(item.name) === wanted || norm(item.name).includes(wanted) || wanted.includes(norm(item.name)))
    if (!row || !includeCompany(candidateId, row.companyId)) return null
    return { company: row.name, until: null }
  }
  const company = findTheirCompany(candidateId, action.company)
  if (!company) return null
  const until = action.forAYear ? aYearFromNow() : null
  excludeCompany(candidateId, company.id, { reason: null, until, source: 'chat' })
  return { company: company.name, until }
}

// The other chat app (#52), asked for in the chat: the one-time link that
// connects it, as the app's own button makes, or why there is none.
export function connectApp(
  candidateId: string,
  app: 'whatsapp' | 'telegram',
  whatsappMessage: (code: string) => string,
): { url: string } | 'unavailable' | 'connected' {
  const there = chatAppsOf(candidateId).find((item) => item.app === app)
  if (!there) return 'unavailable'
  if (there.connected) return 'connected'
  const started = app === 'telegram' ? startTelegramLink(candidateId) : startLink(candidateId, whatsappMessage)
  return started ? { url: started.url } : 'unavailable'
}
