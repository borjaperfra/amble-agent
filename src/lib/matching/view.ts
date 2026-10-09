import { applicationCv, savedAnswers } from '../apply/answers'
import { canFillForms } from '../apply/chrome'
import { followupOutcomes, type FollowupAnswer } from '../whatsapp/followups'
import { linkOf } from '../whatsapp/link'
import { zernioConfig } from '../whatsapp/zernio'
import { getPreparedApplication, type PreparedApplication } from '../apply/prepare'
import { candidateById, listCapabilities, listConfirmedPreferences } from '../db/repo'
import { getDb } from '../db/db'
import { listDecisions, listMatchesForKey, listWanted, type MatchListing, type MatchProgress, type MatchResponse, type MatchRow } from '../db/matching'
import { ASSESS_VERSION, LANGUAGE_GATE, OFFICE_ABROAD_GATE, OFFICE_ELSEWHERE_GATE, REMOTE_COUNTRIES_GATE, REMOTE_ELSEWHERE_GATE, REMOTE_UNCONFIRMED_GATE, SALARY_FLOOR_GATE, type Explanation, type Gate, type RoleFit } from './assess'
import { currentMatchKey, lastReadStats, placeFit } from './run'
import { buildMatchingProfile } from './profile'
import { workplaceShown } from './workplace'
import { storedRoleQuery } from './role-query'
import { estimatesFor, payRank, shownEstimate, type ShownEstimate } from '../salary/estimate'
import { releaseDue } from './release'

// The first read starts while the setup's questions are answered (setup.ts).
const SETUP_READ_MS = 15 * 60 * 1000

// What the opportunities screen shows: assessments made against the current
// profile and assessor version. After a preference changes, an offer not yet
// judged again keeps its earlier verdict, marked as such (`stale`): hidden,
// the screen emptied at every correction until the re-read reached it, and
// stayed empty while the search was paused. A stale one never interrupts:
// it is not counted as new, nor in the week, nor in the pile.

export interface FoundOpportunity {
  id: string
  company: string
  title: string
  location: string | null
  workplace: string | null
  // As published; null when the offer does not say.
  salary: string | null
  // When it publishes none: what the reference table says such a role pays,
  // always shown as an estimate with its source. Never a reason to set it aside.
  estimate: ShownEstimate | null
  url: string | null
  closed: boolean
  fit: RoleFit
  summary: string
  why: { text: string; evidence: string | null; quote: string | null }[]
  considerAlso: { text: string; quote: string | null } | null
  unknowns: string[]
  response: MatchResponse | null
  // Judged before their latest change of rules, and not yet again.
  stale: boolean
}

export type DiscardReason =
  | { kind: 'wrong_role'; text: string }
  | { kind: 'below_level'; text: string }
  | { kind: 'above_level'; text: string }
  | { kind: 'filter'; rule: string; quote: string | null }
  | { kind: 'salary_floor'; quote: string | null }
  | { kind: 'language'; quote: string | null }
  | { kind: 'remote_unconfirmed'; places: string | null }
  | { kind: 'remote_elsewhere'; places: string | null }
  | { kind: 'remote_countries'; places: string | null }
  // Office days, and its offices are only where they would not go (set aside
  // on what the offer states: facts.ts).
  | { kind: 'office_elsewhere'; places: string | null }
  // Not remote, and only in countries they did not ask for.
  | { kind: 'office_abroad'; places: string | null }
  // It publishes no salary, and what such roles pay is below their floor.
  | { kind: 'salary_estimate'; estimate: ShownEstimate }
  // The posting's text could not be read: judged on its title, never shown.
  | { kind: 'unread' }
  // None of their rules failed, but one could not be checked: why, in the assessor's words.
  | { kind: 'unverified'; rule: string; note: string }
  | { kind: 'no_reason' }

export interface DiscardedOpportunity {
  id: string
  company: string
  title: string
  url: string | null
  reasons: DiscardReason[]
  response: MatchResponse | null
  stale: boolean
}

// What the Rep read in the last week, for the listening screen: a few of
// them, each with its verdict, so the work is visible as judgment, not as
// activity. What passed comes first.
export interface WeekEntry {
  id: string
  company: string
  title: string
  status: 'found' | 'maybe' | 'aside'
  reason: DiscardReason | null
}

export interface WeekLedger {
  read: number
  worth: number
  entries: WeekEntry[]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const WEEK_ENTRIES = 6
const WEEK_FOUND_FIRST = 3

// An offer the candidate said they want: what is still unknown about it and
// how far they have taken it. One role posted in several cities is one entry.
export interface WantedOpportunity {
  key: string
  opportunityIds: string[]
  company: string
  title: string
  location: string | null
  workplace: string | null
  salary: string | null
  estimate: ShownEstimate | null
  url: string | null
  closed: boolean
  summary: string | null
  considerAlso: { text: string; quote: string | null } | null
  unknowns: string[]
  progress: MatchProgress | null
  // When they applied or stopped following; otherwise when they said they wanted it.
  since: string
  // What the Rep prepared to apply, if they asked for it.
  prepared: PreparedApplication | null
  // What they answered on WhatsApp about an application they sent.
  outcome: FollowupAnswer | null
}

export interface OpportunitiesView {
  // Roles that fit: the only ones that interrupt the candidate.
  found: FoundOpportunity[]
  // Adjacent roles (stretch): worth a look, never an interruption. Showing them
  // alongside the real ones would spend the trust the interruption relies on.
  maybe: FoundOpportunity[]
  discarded: DiscardedOpportunity[]
  // Shown, open and not yet answered: what makes Listening say "I found something".
  unseen: number
  // Found but not given to them yet: a few reach them each day (release.ts).
  withheld: number
  week: WeekLedger
  // What they said they want: still to send, sent, and no longer followed.
  wanted: WantedOpportunity[]
  sent: WantedOpportunity[]
  dropped: WantedOpportunity[]
  // What they send with applications: their CV, what they answered before,
  // and whether the Rep can fill the offer's form here.
  applicant: { cv: string | null; answers: Record<string, string>; canFill: boolean }
  // Whether amble can ask them on WhatsApp how applications are going.
  whatsapp: { available: boolean; linked: boolean }
  // How many offers they have answered: after the first few, the Rep asks
  // to carry on on WhatsApp.
  decided: number
  // Nothing of theirs to show: why, in numbers, from what was read.
  drought: Drought | null
}

// Why nothing reaches them yet: of the offers open, how many are of their
// role, how many were read, and what set those aside, most common first.
export interface Drought {
  open: number
  ofTheirRole: number
  read: number
  waiting: number
  reasons: { kind: 'role' | 'place' | 'pay' | 'language' | 'unread' | 'rule'; rule: string | null; count: number }[]
}

function droughtOf(candidateId: string, discarded: DiscardedOpportunity[]): Drought | null {
  const stats = lastReadStats(candidateId)
  if (!stats && discarded.length === 0) return null
  const counts = new Map<string, { kind: Drought['reasons'][number]['kind']; rule: string | null; count: number }>()
  const add = (kind: Drought['reasons'][number]['kind'], rule: string | null = null) => {
    const key = `${kind}|${rule ?? ''}`
    counts.set(key, { kind, rule, count: (counts.get(key)?.count ?? 0) + 1 })
  }
  for (const offer of discarded) {
    // What set it aside first: one reason per offer.
    const reason = offer.reasons[0]
    if (!reason) continue
    if (reason.kind === 'wrong_role' || reason.kind === 'below_level' || reason.kind === 'above_level') add('role')
    else if (reason.kind === 'remote_unconfirmed' || reason.kind === 'remote_elsewhere' || reason.kind === 'remote_countries' || reason.kind === 'office_elsewhere' || reason.kind === 'office_abroad') add('place')
    else if (reason.kind === 'salary_floor' || reason.kind === 'salary_estimate') add('pay')
    else if (reason.kind === 'language') add('language')
    else if (reason.kind === 'unread') add('unread')
    else if (reason.kind === 'filter' || reason.kind === 'unverified') add('rule', reason.rule)
  }
  return {
    open: stats?.open ?? 0,
    ofTheirRole: stats?.prefilterPassed ?? 0,
    read: discarded.length,
    waiting: stats?.waiting ?? 0,
    reasons: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 4),
  }
}

const wants = (decision: MatchResponse | undefined) => decision === 'interested' || decision === 'wanted_anyway'

// Offers they want, one entry per role. Their decisions outlive any
// assessment, so what is shown about each comes from its latest one.
function wantedOpportunities(candidateId: string, floor: Floor): WantedOpportunity[] {
  const byRole = new Map<string, WantedOpportunity>()
  const outcomes = followupOutcomes(candidateId)
  const rows = listWanted(candidateId)
  const estimates = estimatesFor(rows.map((row) => row.opportunity_id))
  for (const row of rows) {
    const key = row.model_run_id ? `${row.model_run_id}|${row.title}` : `${row.company_name}|${row.title}|${row.workplace ?? ''}`
    const known = byRole.get(key)
    if (known) {
      known.opportunityIds.push(row.opportunity_id)
      known.outcome = known.outcome ?? outcomes.get(row.opportunity_id) ?? null
      if (row.location && !known.location?.includes(row.location)) known.location = [known.location, row.location].filter(Boolean).join(' · ')
      if (!row.closed_at) {
        known.closed = false
        known.url = row.url ?? known.url
      }
      continue
    }
    const explanation = row.explanation ? (JSON.parse(row.explanation) as Explanation) : null
    byRole.set(key, {
      key,
      opportunityIds: [row.opportunity_id],
      company: row.company_name,
      title: row.title,
      location: row.location,
      workplace: workplaceShown(row.opportunity_id, row.workplace),
      salary: salaryText(row),
      estimate: salaryText(row) ? null : shownEstimate(estimates.get(row.opportunity_id), floor),
      url: row.url,
      closed: row.closed_at !== null,
      summary: explanation?.summary || null,
      considerAlso: explanation?.considerAlso ?? null,
      unknowns: explanation?.unknowns ?? [],
      progress: row.progress,
      since: row.progress_at ?? row.decided_at,
      prepared: getPreparedApplication(candidateId, row.opportunity_id),
      outcome: outcomes.get(row.opportunity_id) ?? null,
    })
  }
  return [...byRole.values()]
}

type Floor = { amount: number; currency: string } | null

function salaryText(match: Pick<MatchListing, 'salary_raw' | 'salary_min' | 'salary_max' | 'salary_currency'>): string | null {
  if (match.salary_raw) return match.salary_raw
  if (!match.salary_min && !match.salary_max) return null
  const range = [match.salary_min, match.salary_max].filter(Boolean).map((n) => Math.round((n as number) / 1000) + 'K').join('–')
  return `${range} ${match.salary_currency ?? ''}`.trim()
}

// Postings of one role in several cities were judged together (one model run):
// the screen shows the role once, with every city. The link and the state are
// those of a posting still open, if any is.
function collapseRoles(matches: (MatchRow & MatchListing)[]): (MatchRow & MatchListing)[] {
  const roles = new Map<string, (MatchRow & MatchListing)[]>()
  for (const match of matches) {
    const key = match.model_run_id ? `${match.model_run_id}|${match.title}` : match.id
    const postings = roles.get(key)
    if (postings) postings.push(match)
    else roles.set(key, [match])
  }
  return [...roles.values()].map((postings) => {
    const lead = postings.find((posting) => !posting.closed_at) ?? postings[0]
    const open = postings.filter((posting) => !posting.closed_at)
    const places = [...new Set((open.length ? open : postings).map((posting) => posting.location).filter(Boolean))]
    return { ...lead, location: places.join(' · ') || null }
  })
}

// The latest verdict on each offer made with an earlier profile (same
// assessor version), for offers the current one has not judged yet.
function earlierMatches(candidateId: string, matchKey: string, judged: Set<string>): (MatchRow & MatchListing)[] {
  const rows = getDb()
    .prepare(
      `SELECT m.*, o.title, o.url, o.closed_at, o.location, o.workplace, o.salary_raw, o.salary_min, o.salary_max, o.salary_currency, c.name AS company_name
       FROM opportunity_matches m
       JOIN opportunities o ON o.id = m.opportunity_id
       JOIN companies c ON c.id = o.company_id
       WHERE m.candidate_id = ? AND m.profile_hash != ? AND m.profile_hash LIKE ?
       ORDER BY m.created_at DESC, m.rowid`,
    )
    .all(candidateId, matchKey, `%:${ASSESS_VERSION}`) as unknown as (MatchRow & MatchListing)[]
  const latest: (MatchRow & MatchListing)[] = []
  const seen = new Set(judged)
  for (const row of rows) {
    if (seen.has(row.opportunity_id)) continue
    seen.add(row.opportunity_id)
    latest.push(row)
  }
  return latest
}

export function getOpportunitiesView(candidateId: string): OpportunitiesView {
  const candidate = candidateById(candidateId)
  const matchKey = currentMatchKey(candidate.id)
  const current = listMatchesForKey(candidate.id, matchKey)
  const matches = collapseRoles([...current, ...earlierMatches(candidate.id, matchKey, new Set(current.map((match) => match.opportunity_id)))])
  const capabilityNames = new Map(listCapabilities(candidate.id).map((capability) => [capability.id, capability.name]))
  const ruleLabels = new Map([
    ...listConfirmedPreferences(candidate.id).map((row): [string, string] => [row.id, row.label ?? row.wording ?? row.statement]),
  ])
  const decisions = listDecisions(candidate.id)
  // What the table says the roles that publish no salary pay, and the floor
  // it is compared with (from the query already designed for their profile).
  const estimates = estimatesFor(matches.map((match) => match.opportunity_id))
  const roleQuery = storedRoleQuery(candidate.id, buildMatchingProfile(candidate.id))
  const floor = roleQuery?.salaryFloor ?? null

  // A few at a time: what is not released yet waits, unless they answered
  // it or amble already sent it on WhatsApp.
  const released = releaseDue(candidate.id)
  const sentOnWhatsapp = new Set(
    (getDb().prepare('SELECT opportunity_id FROM offer_sends WHERE candidate_id = ? AND sent_at IS NOT NULL').all(candidate.id) as unknown as { opportunity_id: string }[]).map(
      (row) => row.opportunity_id,
    ),
  )
  let withheld = 0

  const found: FoundOpportunity[] = []
  const discarded: DiscardedOpportunity[] = []
  const since = Date.now() - WEEK_MS
  const week: (WeekEntry & { at: string })[] = []
  let read = 0

  for (const match of matches) {
    const explanation = JSON.parse(match.explanation) as Explanation
    // What they decided is kept on the offer, not on this assessment of it.
    const decision = decisions.get(match.opportunity_id)
    const response = decision?.decision ?? null
    // An offer they want has its own place: it is no longer something to answer.
    const wanted = wants(decision?.decision)
    const stale = match.profile_hash !== matchKey
    // What was read this week is what the current rules judged.
    const thisWeek = !stale && Date.parse(match.created_at) >= since
    if (thisWeek) read++

    // Shown, but publishing no salary and estimated below their floor: set
    // aside with that reason, unless they already answered it (#20).
    const estimate = match.verdict === 'show' && !salaryText(match) ? shownEstimate(estimates.get(match.opportunity_id), floor) : null
    if (estimate?.belowFloor != null && !decision && !match.response && !sentOnWhatsapp.has(match.opportunity_id)) {
      if (match.closed_at) continue
      const reason: DiscardReason = { kind: 'salary_estimate', estimate }
      discarded.push({ id: match.id, company: match.company_name, title: match.title, url: match.url, reasons: [reason], response, stale })
      if (thisWeek) week.push({ id: match.id, company: match.company_name, title: match.title, status: 'aside', reason, at: match.created_at })
      continue
    }

    if (match.verdict === 'show') {
      if (!released.has(match.opportunity_id) && !decision && !match.response && !sentOnWhatsapp.has(match.opportunity_id)) {
        if (!match.closed_at && !stale) withheld++
        continue
      }
      if (!wanted) found.push({
        id: match.id,
        company: match.company_name,
        title: match.title,
        location: match.location,
        workplace: workplaceShown(match.opportunity_id, match.workplace),
        salary: salaryText(match),
        estimate: salaryText(match) ? null : shownEstimate(estimates.get(match.opportunity_id), floor),
        url: match.url,
        closed: match.closed_at !== null,
        fit: explanation.roleFit.fit,
        summary: explanation.summary,
        why: explanation.why.map((reason) => ({
          text: reason.text,
          evidence: reason.capabilityId ? (capabilityNames.get(reason.capabilityId) ?? null) : null,
          quote: reason.quote,
        })),
        considerAlso: explanation.considerAlso,
        unknowns: explanation.unknowns,
        response,
        stale,
      })
      if (thisWeek && !match.closed_at) {
        const status = explanation.roleFit.fit === 'fits' ? 'found' : 'maybe'
        week.push({ id: match.id, company: match.company_name, title: match.title, status, reason: null, at: match.created_at })
      }
      continue
    }

    // A closed offer the Rep set aside is no longer worth revisiting.
    if (match.closed_at) continue
    const gates = JSON.parse(match.gates) as Gate[]
    const reasons: DiscardReason[] = []
    if (explanation.roleFit.fit === 'wrong_role') reasons.push({ kind: 'wrong_role', text: explanation.roleFit.reason })
    if (explanation.roleFit.fit === 'below_level') reasons.push({ kind: 'below_level', text: explanation.roleFit.reason })
    if (explanation.roleFit.fit === 'above_level') reasons.push({ kind: 'above_level', text: explanation.roleFit.reason })
    for (const gate of gates) {
      if (gate.ruleId === REMOTE_UNCONFIRMED_GATE) reasons.push({ kind: 'remote_unconfirmed', places: gate.quote })
      else if (gate.ruleId === REMOTE_ELSEWHERE_GATE) reasons.push({ kind: 'remote_elsewhere', places: gate.quote })
      else if (gate.ruleId === REMOTE_COUNTRIES_GATE) reasons.push({ kind: 'remote_countries', places: gate.quote })
      else if (gate.ruleId === OFFICE_ELSEWHERE_GATE) reasons.push({ kind: 'office_elsewhere', places: gate.quote })
      else if (gate.ruleId === OFFICE_ABROAD_GATE) reasons.push({ kind: 'office_abroad', places: gate.quote })
      else if (gate.result !== 'fail') continue
      else if (gate.ruleId === SALARY_FLOOR_GATE) reasons.push({ kind: 'salary_floor', quote: gate.quote })
      else if (gate.ruleId === LANGUAGE_GATE) reasons.push({ kind: 'language', quote: gate.quote })
      else reasons.push({ kind: 'filter', rule: ruleLabels.get(gate.ruleId) ?? gate.ruleId, quote: gate.quote })
    }
    if (reasons.length === 0) {
      // Held with reasons to show it and nothing against it: the only such
      // case is a posting whose text could not be read (judged on its title).
      if (match.verdict === 'hold' && explanation.why.length > 0) reasons.push({ kind: 'unread' })
      else {
        // Nothing failed, but a rule of theirs could not be checked and the
        // assessor said why: that is what held it, and it is what they read.
        const unclear = gates.find((gate) => gate.result === 'unknown' && gate.note && ruleLabels.has(gate.ruleId))
        reasons.push(unclear ? { kind: 'unverified', rule: ruleLabels.get(unclear.ruleId) as string, note: unclear.note } : { kind: 'no_reason' })
      }
    }
    if (!wanted) discarded.push({ id: match.id, company: match.company_name, title: match.title, url: match.url, reasons, response, stale })
    if (thisWeek) week.push({ id: match.id, company: match.company_name, title: match.title, status: 'aside', reason: reasons[0], at: match.created_at })
  }

  const newest = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at)
  const passed = week.filter((entry) => entry.status === 'found').sort(newest).slice(0, WEEK_FOUND_FIRST)
  const rest = week.filter((entry) => !passed.includes(entry)).sort(newest)
  const entries = [...passed, ...rest]
    .slice(0, WEEK_ENTRIES)
    .map((entry) => ({ id: entry.id, company: entry.company, title: entry.title, status: entry.status, reason: entry.reason }))

  const wantedAll = wantedOpportunities(candidate.id, floor)
  const firstJudged = (getDb().prepare('SELECT MIN(created_at) AS at FROM opportunity_matches WHERE candidate_id = ?').get(candidate.id) as { at: string | null }).at
  const setupRead = firstJudged !== null && Date.now() - Date.parse(firstJudged) < SETUP_READ_MS

  // Unanswered first; within that, where it is: their city or country, then
  // what is open to them, then elsewhere in Europe, then only outside it. A
  // published salary used to come first, and the offers that publish one are
  // mostly American: the top of the screen filled with them. Within the same
  // place, offers that publish a salary, then those whose estimate reaches
  // their floor, then those with nothing known, then those estimated below
  // it; then newest, as the query already orders.
  const near = (item: FoundOpportunity) => (roleQuery ? placeFit(item.location, roleQuery) : 1)
  const byAnswered = (a: FoundOpportunity, b: FoundOpportunity) =>
    Number(a.response !== null) - Number(b.response !== null) ||
    Number(a.stale) - Number(b.stale) ||
    near(a) - near(b) ||
    payRank(b) - payRank(a)
  const fits = found.filter((item) => item.fit === 'fits').sort(byAnswered)
  const maybe = found.filter((item) => item.fit !== 'fits').sort(byAnswered)

  return {
    found: fits,
    maybe,
    discarded,
    // Their very first offers, judged while they answered the setup's
    // questions and not yet read again with the answers, are still new to them.
    unseen: fits.filter((item) => !item.closed && (!item.stale || setupRead) && item.response === null).length,
    withheld,
    week: { read, worth: week.filter((entry) => entry.status === 'found').length, entries },
    wanted: wantedAll.filter((item) => item.progress === null),
    sent: wantedAll.filter((item) => item.progress === 'applied'),
    dropped: wantedAll.filter((item) => item.progress === 'dropped'),
    applicant: { cv: applicationCv(candidate.id)?.filename ?? null, answers: savedAnswers(candidate.id), canFill: canFillForms() },
    whatsapp: { available: zernioConfig() !== null, linked: linkOf(candidate.id) !== null },
    decided: decisions.size,
    drought: fits.length + maybe.length === 0 && withheld === 0 ? droughtOf(candidate.id, discarded) : null,
  }
}
