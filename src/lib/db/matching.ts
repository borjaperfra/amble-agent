import { getDb } from './db'
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

export function assessedOpportunityIds(profileHash: string): Set<string> {
  const rows = getDb()
    .prepare('SELECT opportunity_id FROM opportunity_matches WHERE profile_hash = ?')
    .all(profileHash) as unknown as { opportunity_id: string }[]
  return new Set(rows.map((row) => row.opportunity_id))
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
  getDb()
    .prepare(
      `INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, dropped, model_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(opportunity_id, profile_hash) DO NOTHING`,
    )
    .run(
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

export function listMatches(candidateId: string, verdict?: MatchVerdict): (MatchRow & { title: string; company_name: string; url: string | null; closed_at: string | null })[] {
  const where = verdict ? 'AND m.verdict = ?' : ''
  const params = verdict ? [candidateId, verdict] : [candidateId]
  return getDb()
    .prepare(
      `SELECT m.*, o.title, o.url, o.closed_at, c.name AS company_name
       FROM opportunity_matches m
       JOIN opportunities o ON o.id = m.opportunity_id
       JOIN companies c ON c.id = o.company_id
       WHERE m.candidate_id = ? ${where}
       ORDER BY m.created_at DESC`,
    )
    .all(...params) as unknown as (MatchRow & { title: string; company_name: string; url: string | null; closed_at: string | null })[]
}

export function respondToMatch(id: string, response: 'interested' | 'not_for_me', reason: string | null): void {
  getDb()
    .prepare('UPDATE opportunity_matches SET response = ?, response_reason = ?, responded_at = ? WHERE id = ?')
    .run(response, reason, now(), id)
}
