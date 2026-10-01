import { getDb, inTransaction, prepared } from './db'
import { newId, now } from './repo'

export interface RoleQueryRow {
  id: string
  candidate_id: string
  profile_hash: string
  query: string
  model_run_id: string | null
  created_at: string
}

export type MatchVerdict = 'show' | 'hold' | 'discarded'

export interface MatchRow {
  id: string
  candidate_id: string
  opportunity_id: string
  profile_hash: string
  verdict: MatchVerdict
  gates: string
  explanation: string
  dropped: string
  model_run_id: string | null
  created_at: string
  response: string | null
  response_reason: string | null
  responded_at: string | null
  // Carried over from an earlier profile's judgment without a model call
  // (matching/carry.ts): that judgment's key, and why it still stands.
  carried_from: string | null
  carried_reason: string | null
}

export function getRoleQuery(candidateId: string, profileHash: string): RoleQueryRow | undefined {
  return getDb()
    .prepare('SELECT * FROM role_queries WHERE candidate_id = ? AND profile_hash = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId, profileHash) as unknown as RoleQueryRow | undefined
}

export function insertRoleQuery(candidateId: string, profileHash: string, query: unknown, modelRunId: string): RoleQueryRow {
  const id = newId('rq')
  getDb()
    .prepare('INSERT INTO role_queries (id, candidate_id, profile_hash, query, model_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, candidateId, profileHash, JSON.stringify(query), modelRunId, now())
  return getDb().prepare('SELECT * FROM role_queries WHERE id = ?').get(id) as unknown as RoleQueryRow
}

export function assessedOpportunityIds(candidateId: string, profileHash: string): Set<string> {
  const rows = getDb()
    .prepare('SELECT opportunity_id FROM opportunity_matches WHERE candidate_id = ? AND profile_hash = ?')
    .all(candidateId, profileHash) as unknown as { opportunity_id: string }[]
  return new Set(rows.map((row) => row.opportunity_id))
}

export function hasAnyMatch(candidateId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM opportunity_matches WHERE candidate_id = ? LIMIT 1').get(candidateId))
}

export function insertMatch(row: {
  candidateId: string
  opportunityId: string
  profileHash: string
  verdict: MatchVerdict
  gates: unknown
  explanation: unknown
  dropped: unknown[]
  modelRunId: string | null
}): void {
  prepared(
    `INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, dropped, model_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(opportunity_id, profile_hash) DO NOTHING`,
  ).run(
    newId('mat'),
    row.candidateId,
    row.opportunityId,
    row.profileHash,
    row.verdict,
    JSON.stringify(row.gates),
    JSON.stringify(row.explanation),
    JSON.stringify(row.dropped),
    row.modelRunId,
    now(),
  )
}

export function getMatch(id: string): MatchRow | undefined {
  return getDb().prepare('SELECT * FROM opportunity_matches WHERE id = ?').get(id) as unknown as MatchRow | undefined
}

export interface MatchListing {
  title: string
  company_name: string
  url: string | null
  closed_at: string | null
  location: string | null
  workplace: string | null
  salary_raw: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
}

// Newest first; the postings of one role, judged at the same moment, in the
// order they were stored.
export function listMatchesForKey(
  candidateId: string,
  matchKey: string,
): (MatchRow & MatchListing)[] {
  return getDb()
    .prepare(
      `SELECT m.*, o.title, o.url, o.closed_at, o.location, o.workplace, o.salary_raw, o.salary_min, o.salary_max, o.salary_currency, c.name AS company_name
       FROM opportunity_matches m
       JOIN opportunities o ON o.id = m.opportunity_id
       JOIN companies c ON c.id = o.company_id
       WHERE m.candidate_id = ? AND m.profile_hash = ?
       ORDER BY m.created_at DESC, m.rowid`,
    )
    .all(candidateId, matchKey) as unknown as (MatchRow & MatchListing)[]
}

// 'wanted_anyway' is the candidate overruling a discard: the signal that a
// filter or a role-fit judgment was wrong.
export type MatchResponse = 'interested' | 'not_for_me' | 'wanted_anyway'

export type MatchProgress = 'applied' | 'dropped'

export interface DecisionRow {
  candidate_id: string
  opportunity_id: string
  decision: MatchResponse
  reason: string | null
  decided_at: string
  progress: MatchProgress | null
  progress_at: string | null
}

// The assessments an answer reaches: the one answered and every city's
// posting of the same role, judged in the same model run. Only the
// candidate's own: an id that is someone else's reaches nothing.
function roleMatches(matchId: string, candidateId: string): { id: string; opportunity_id: string }[] {
  const db = getDb()
  const match = db
    .prepare('SELECT id, opportunity_id, model_run_id, profile_hash FROM opportunity_matches WHERE id = ? AND candidate_id = ?')
    .get(matchId, candidateId) as { id: string; opportunity_id: string; model_run_id: string | null; profile_hash: string } | undefined
  if (!match) return []
  if (!match.model_run_id) return [match]
  return db
    .prepare('SELECT id, opportunity_id FROM opportunity_matches WHERE model_run_id = ? AND profile_hash = ? AND candidate_id = ?')
    .all(match.model_run_id, match.profile_hash, candidateId) as { id: string; opportunity_id: string }[]
}

// An answer is about the role, so it reaches every city's posting judged with
// it. It is kept on the offer, where it outlives any assessment; how far the
// candidate took it (applied, dropped) is kept as it was.
export function respondToMatch(id: string, candidateId: string, response: MatchResponse, reason: string | null): void {
  const db = getDb()
  const decide = db.prepare(
    `INSERT INTO opportunity_decisions (candidate_id, opportunity_id, decision, reason, decided_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (candidate_id, opportunity_id) DO UPDATE SET decision = excluded.decision, reason = excluded.reason, decided_at = excluded.decided_at`,
  )
  // Also on the assessment, which still records what was answered to it.
  const answer = db.prepare('UPDATE opportunity_matches SET response = ?, response_reason = ?, responded_at = ? WHERE id = ?')
  inTransaction(() => {
    const at = now()
    for (const match of roleMatches(id, candidateId)) {
      decide.run(candidateId, match.opportunity_id, response, reason, at)
      answer.run(response, reason, at, match.id)
    }
  })
}

export function listDecisions(candidateId: string): Map<string, DecisionRow> {
  const rows = getDb().prepare('SELECT * FROM opportunity_decisions WHERE candidate_id = ?').all(candidateId) as unknown as DecisionRow[]
  return new Map(rows.map((row) => [row.opportunity_id, row]))
}

// How far the candidate took offers they wanted: applied, or no longer
// following. Null takes it back. Only on offers they said they wanted.
export function setProgress(candidateId: string, opportunityIds: string[], progress: MatchProgress | null): number {
  const update = getDb().prepare(
    `UPDATE opportunity_decisions SET progress = ?, progress_at = ?
     WHERE candidate_id = ? AND opportunity_id = ? AND decision IN ('interested', 'wanted_anyway')`,
  )
  let changed = 0
  for (const opportunityId of opportunityIds) changed += Number(update.run(progress, progress ? now() : null, candidateId, opportunityId).changes)
  return changed
}

export interface WantedListing {
  opportunity_id: string
  decision: MatchResponse
  decided_at: string
  progress: MatchProgress | null
  progress_at: string | null
  title: string
  company_name: string
  url: string | null
  closed_at: string | null
  location: string | null
  workplace: string | null
  salary_raw: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  // The latest assessment of the offer, whichever profile it was made against.
  explanation: string | null
  model_run_id: string | null
}

export function listWanted(candidateId: string): WantedListing[] {
  return getDb()
    .prepare(
      `SELECT d.opportunity_id, d.decision, d.decided_at, d.progress, d.progress_at,
              o.title, o.url, o.closed_at, o.location, o.workplace, o.salary_raw, o.salary_min, o.salary_max, o.salary_currency,
              c.name AS company_name,
              (SELECT m.explanation FROM opportunity_matches m WHERE m.candidate_id = d.candidate_id AND m.opportunity_id = d.opportunity_id
               ORDER BY m.created_at DESC LIMIT 1) AS explanation,
              (SELECT m.model_run_id FROM opportunity_matches m WHERE m.candidate_id = d.candidate_id AND m.opportunity_id = d.opportunity_id
               ORDER BY m.created_at DESC LIMIT 1) AS model_run_id
       FROM opportunity_decisions d
       JOIN opportunities o ON o.id = d.opportunity_id
       JOIN companies c ON c.id = o.company_id
       WHERE d.candidate_id = ? AND d.decision IN ('interested', 'wanted_anyway')
       ORDER BY COALESCE(d.progress_at, d.decided_at) DESC`,
    )
    .all(candidateId) as unknown as WantedListing[]
}
