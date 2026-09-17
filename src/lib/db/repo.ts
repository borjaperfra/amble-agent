import { randomUUID } from 'node:crypto'
import { getDb } from './db'

export const DEFAULT_CANDIDATE_ID = 'user-zero'

export function now(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export interface CandidateRow {
  id: string
  name: string | null
  descriptor: string | null
  descriptor_grounded: number
  created_at: string
}

export interface SourceRow {
  id: string
  candidate_id: string
  type: string
  name: string
  uri: string | null
  original_filename: string | null
  mime_type: string | null
  stored_path: string | null
  char_count: number | null
  status: string
  status_detail: string | null
  created_at: string
  processed_at: string | null
}

export interface ClaimRow {
  id: string
  candidate_id: string
  source_id: string | null
  interview_turn_id: string | null
  statement: string
  claim_type: string
  epistemic_state: string
  source_excerpt: string | null
  source_location: string | null
  confidence: number | null
  requires_confirmation: number
  possible_capabilities: string
  created_at: string
}

export interface EvidenceRow {
  id: string
  candidate_id: string
  claim_id: string | null
  statement: string
  epistemic_state: string
  source_type: string
  source_id: string | null
  source_excerpt: string | null
  strength: string
  confidence: number | null
  corroborated_by: string
  contradicted_by: string
  candidate_confirmed: number
  human_verified: number
  interview_turn_id: string | null
  created_at: string
  updated_at: string
}

export interface CapabilityRow {
  id: string
  candidate_id: string
  name: string
  assessment: string
  reason: string
  updated_at: string
}

export interface UncertaintyRow {
  id: string
  candidate_id: string
  capability_id: string | null
  description: string
  reason: string | null
  materiality: string
  status: string
  resolvable_by_interview: number
  created_at: string
  resolved_at: string | null
  resolved_by_turn: string | null
}

export interface InterviewRow {
  id: string
  candidate_id: string
  status: string
  created_at: string
  completed_at: string | null
}

export interface InterviewTurnRow {
  id: string
  interview_id: string
  idx: number
  question: string | null
  question_reason: string | null
  target_capability_ids: string
  target_uncertainty_ids: string
  answer: string | null
  created_at: string
  answered_at: string | null
}

export interface ModelRunRow {
  id: string
  candidate_id: string | null
  task: string
  task_version: string
  provider: string | null
  model_id: string | null
  base_url: string | null
  prompt_chars: number | null
  output_chars: number | null
  latency_ms: number | null
  ok: number
  error: string | null
  raw_output: string | null
  created_at: string
}

export interface EvaluationRow {
  id: string
  candidate_id: string
  target_type: string
  target_id: string
  verdict: string
  comment: string | null
  created_at: string
}

export interface IntentRow {
  id: string
  candidate_id: string
  raw_answer: string
  groups: string
  listening_for: string
  created_at: string
  confirmed_at: string | null
  valid_until: string | null
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function getOrCreateCandidate(): CandidateRow {
  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM candidates WHERE id = ?')
    .get(DEFAULT_CANDIDATE_ID) as unknown as CandidateRow | undefined
  if (existing) return existing
  db.prepare('INSERT INTO candidates (id, created_at) VALUES (?, ?)').run(
    DEFAULT_CANDIDATE_ID,
    now(),
  )
  return db.prepare('SELECT * FROM candidates WHERE id = ?').get(DEFAULT_CANDIDATE_ID) as unknown as CandidateRow
}

export function updateCandidateProfile(id: string, name: string | null, descriptor: string | null, descriptorGrounded: boolean): void {
  const db = getDb()
  db.prepare(
    'UPDATE candidates SET name = COALESCE(?, name), descriptor = ?, descriptor_grounded = ? WHERE id = ?',
  ).run(name, descriptor, descriptorGrounded ? 1 : 0, id)
}

export function setCandidateNameIfEmpty(id: string, name: string): void {
  getDb()
    .prepare('UPDATE candidates SET name = ? WHERE id = ? AND name IS NULL')
    .run(name, id)
}

export function insertSource(row: Omit<SourceRow, 'created_at' | 'processed_at'> & { processed_at?: string | null }): SourceRow {
  const db = getDb()
  db.prepare(
    `INSERT INTO sources (id, candidate_id, type, name, uri, original_filename, mime_type, stored_path, char_count, status, status_detail, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.candidate_id,
    row.type,
    row.name,
    row.uri,
    row.original_filename,
    row.mime_type,
    row.stored_path,
    row.char_count,
    row.status,
    row.status_detail,
    now(),
    row.processed_at ?? null,
  )
  return getSource(row.id) as unknown as SourceRow
}

export function getSource(id: string): SourceRow | undefined {
  return getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as unknown as SourceRow | undefined
}

export function listSources(candidateId: string): SourceRow[] {
  return getDb()
    .prepare('SELECT * FROM sources WHERE candidate_id = ? ORDER BY created_at ASC')
    .all(candidateId) as unknown as SourceRow[]
}

export function listUnprocessedSources(candidateId: string): SourceRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM sources WHERE candidate_id = ? AND status = 'extracted' AND processed_at IS NULL ORDER BY created_at ASC",
    )
    .all(candidateId) as unknown as SourceRow[]
}

export function updateSourceStatus(id: string, status: string, detail: string | null): void {
  getDb()
    .prepare('UPDATE sources SET status = ?, status_detail = ?, processed_at = ? WHERE id = ?')
    .run(status, detail, status === 'processed' ? now() : null, id)
}

export function insertClaim(row: Omit<ClaimRow, 'created_at'>): ClaimRow {
  const db = getDb()
  db.prepare(
    `INSERT INTO claims (id, candidate_id, source_id, interview_turn_id, statement, claim_type, epistemic_state, source_excerpt, source_location, confidence, requires_confirmation, possible_capabilities, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.candidate_id,
    row.source_id,
    row.interview_turn_id,
    row.statement,
    row.claim_type,
    row.epistemic_state,
    row.source_excerpt,
    row.source_location,
    row.confidence,
    row.requires_confirmation,
    row.possible_capabilities,
    now(),
  )
  return db.prepare('SELECT * FROM claims WHERE id = ?').get(row.id) as unknown as ClaimRow
}

export function listClaims(candidateId: string): ClaimRow[] {
  return getDb()
    .prepare('SELECT * FROM claims WHERE candidate_id = ? ORDER BY created_at ASC')
    .all(candidateId) as unknown as ClaimRow[]
}

export function listClaimsWithoutEvidence(candidateId: string): ClaimRow[] {
  return getDb()
    .prepare(
      `SELECT c.* FROM claims c
       LEFT JOIN evidence e ON e.claim_id = c.id
       WHERE c.candidate_id = ? AND e.id IS NULL
       ORDER BY c.created_at ASC`,
    )
    .all(candidateId) as unknown as ClaimRow[]
}

export function insertEvidence(row: Omit<EvidenceRow, 'created_at' | 'updated_at' | 'corroborated_by' | 'contradicted_by'>): EvidenceRow {
  const db = getDb()
  const ts = now()
  db.prepare(
    `INSERT INTO evidence (id, candidate_id, claim_id, statement, epistemic_state, source_type, source_id, source_excerpt, strength, confidence, candidate_confirmed, human_verified, interview_turn_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.candidate_id,
    row.claim_id,
    row.statement,
    row.epistemic_state,
    row.source_type,
    row.source_id,
    row.source_excerpt,
    row.strength,
    row.confidence,
    row.candidate_confirmed,
    row.human_verified,
    row.interview_turn_id,
    ts,
    ts,
  )
  return db.prepare('SELECT * FROM evidence WHERE id = ?').get(row.id) as unknown as EvidenceRow
}

export function listEvidence(candidateId: string): EvidenceRow[] {
  return getDb()
    .prepare('SELECT * FROM evidence WHERE candidate_id = ? ORDER BY created_at ASC')
    .all(candidateId) as unknown as EvidenceRow[]
}

export function listEvidenceForCapabilities(candidateId: string, capabilityIds: string[]): EvidenceRow[] {
  if (capabilityIds.length === 0) return []
  const db = getDb()
  const placeholders = capabilityIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT DISTINCT e.* FROM evidence e
       JOIN capability_evidence ce ON ce.evidence_id = e.id
       WHERE e.candidate_id = ? AND ce.capability_id IN (${placeholders})
       ORDER BY e.created_at ASC`,
    )
    .all(candidateId, ...capabilityIds) as unknown as EvidenceRow[]
}

export function upsertCapability(candidateId: string, id: string, name: string, assessment: string, reason: string): void {
  getDb()
    .prepare(
      `INSERT INTO capabilities (id, candidate_id, name, assessment, reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, candidate_id) DO UPDATE SET name = excluded.name, assessment = excluded.assessment, reason = excluded.reason, updated_at = excluded.updated_at`,
    )
    .run(id, candidateId, name, assessment, reason, now())
}

export function linkCapabilityEvidence(candidateId: string, capabilityId: string, evidenceIds: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM capability_evidence WHERE candidate_id = ? AND capability_id = ?').run(
    candidateId,
    capabilityId,
  )
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO capability_evidence (capability_id, evidence_id, candidate_id) VALUES (?, ?, ?)',
  )
  for (const evidenceId of evidenceIds) {
    stmt.run(capabilityId, evidenceId, candidateId)
  }
}

export function listCapabilities(candidateId: string): CapabilityRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM capabilities WHERE candidate_id = ? ORDER BY updated_at DESC',
    )
    .all(candidateId) as unknown as CapabilityRow[]
}

export function listCapabilityEvidenceIds(candidateId: string): Map<string, string[]> {
  const rows = getDb()
    .prepare('SELECT capability_id, evidence_id FROM capability_evidence WHERE candidate_id = ?')
    .all(candidateId) as unknown as { capability_id: string; evidence_id: string }[]
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.capability_id) ?? []
    list.push(row.evidence_id)
    map.set(row.capability_id, list)
  }
  return map
}

export function insertUncertainty(row: Omit<UncertaintyRow, 'created_at' | 'resolved_at' | 'resolved_by_turn'>): UncertaintyRow {
  const db = getDb()
  db.prepare(
    `INSERT INTO uncertainties (id, candidate_id, capability_id, description, reason, materiality, status, resolvable_by_interview, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.candidate_id,
    row.capability_id,
    row.description,
    row.reason,
    row.materiality,
    row.status,
    row.resolvable_by_interview,
    now(),
  )
  return db.prepare('SELECT * FROM uncertainties WHERE id = ?').get(row.id) as unknown as UncertaintyRow
}

export function uncertaintyExistsByDescription(candidateId: string, description: string): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM uncertainties WHERE candidate_id = ? AND description = ?')
      .get(candidateId, description),
  )
}

export function updateUncertaintyStatus(id: string, status: string, resolvedByTurn: string | null, reason: string | null): void {
  getDb()
    .prepare(
      'UPDATE uncertainties SET status = ?, resolved_at = ?, resolved_by_turn = ?, reason = COALESCE(?, reason) WHERE id = ?',
    )
    .run(status, status === 'OPEN' ? null : now(), status === 'OPEN' ? null : resolvedByTurn, reason, id)
}

export function listUncertainties(candidateId: string, status?: string): UncertaintyRow[] {
  if (status) {
    return getDb()
      .prepare('SELECT * FROM uncertainties WHERE candidate_id = ? AND status = ? ORDER BY created_at ASC')
      .all(candidateId, status) as unknown as UncertaintyRow[]
  }
  return getDb()
    .prepare('SELECT * FROM uncertainties WHERE candidate_id = ? ORDER BY created_at ASC')
    .all(candidateId) as unknown as UncertaintyRow[]
}

export function getUncertainty(id: string): UncertaintyRow | undefined {
  return getDb().prepare('SELECT * FROM uncertainties WHERE id = ?').get(id) as unknown as UncertaintyRow | undefined
}

export function getOrCreateInterview(candidateId: string): InterviewRow {
  const db = getDb()
  const existing = db
    .prepare("SELECT * FROM interviews WHERE candidate_id = ? AND status = 'active'")
    .get(candidateId) as unknown as InterviewRow | undefined
  if (existing) return existing
  const id = newId('int')
  db.prepare('INSERT INTO interviews (id, candidate_id, status, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    candidateId,
    'active',
    now(),
  )
  return db.prepare('SELECT * FROM interviews WHERE id = ?').get(id) as unknown as InterviewRow
}

export function completeInterview(id: string): void {
  getDb()
    .prepare("UPDATE interviews SET status = 'completed', completed_at = ? WHERE id = ?")
    .run(now(), id)
}

export function listTurns(interviewId: string): InterviewTurnRow[] {
  return getDb()
    .prepare('SELECT * FROM interview_turns WHERE interview_id = ? ORDER BY idx ASC')
    .all(interviewId) as unknown as InterviewTurnRow[]
}

export function insertTurn(row: Omit<InterviewTurnRow, 'created_at' | 'answered_at' | 'answer'>): InterviewTurnRow {
  const db = getDb()
  db.prepare(
    `INSERT INTO interview_turns (id, interview_id, idx, question, question_reason, target_capability_ids, target_uncertainty_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.interview_id, row.idx, row.question, row.question_reason, row.target_capability_ids, row.target_uncertainty_ids, now())
  return db.prepare('SELECT * FROM interview_turns WHERE id = ?').get(row.id) as unknown as InterviewTurnRow
}

export function getTurn(id: string): InterviewTurnRow | undefined {
  return getDb().prepare('SELECT * FROM interview_turns WHERE id = ?').get(id) as unknown as InterviewTurnRow | undefined
}

export function answerTurn(id: string, answer: string): void {
  getDb()
    .prepare('UPDATE interview_turns SET answer = ?, answered_at = ? WHERE id = ?')
    .run(answer, now(), id)
}

export function insertModelRun(row: Omit<ModelRunRow, 'created_at'>): void {
  getDb()
    .prepare(
      `INSERT INTO model_runs (id, candidate_id, task, task_version, provider, model_id, base_url, prompt_chars, output_chars, latency_ms, ok, error, raw_output, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.candidate_id,
      row.task,
      row.task_version,
      row.provider,
      row.model_id,
      row.base_url,
      row.prompt_chars,
      row.output_chars,
      row.latency_ms,
      row.ok,
      row.error,
      row.raw_output,
      now(),
    )
}

export function listModelRuns(candidateId: string, limit = 100): ModelRunRow[] {
  return getDb()
    .prepare('SELECT * FROM model_runs WHERE candidate_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(candidateId, limit) as unknown as ModelRunRow[]
}

export function insertEvaluation(row: Omit<EvaluationRow, 'created_at'>): EvaluationRow {
  const db = getDb()
  db.prepare(
    'INSERT INTO evaluations (id, candidate_id, target_type, target_id, verdict, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.candidate_id, row.target_type, row.target_id, row.verdict, row.comment, now())
  return db.prepare('SELECT * FROM evaluations WHERE id = ?').get(row.id) as unknown as EvaluationRow
}

export function listEvaluations(candidateId: string): EvaluationRow[] {
  return getDb()
    .prepare('SELECT * FROM evaluations WHERE candidate_id = ? ORDER BY created_at DESC')
    .all(candidateId) as unknown as EvaluationRow[]
}

export function replaceDistinctiveProfile(candidateId: string, capabilityIds: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM distinctive_profiles WHERE candidate_id = ?').run(candidateId)
  if (capabilityIds.length === 0) return
  db.prepare('INSERT INTO distinctive_profiles (id, candidate_id, capability_ids, created_at) VALUES (?, ?, ?, ?)').run(
    newId('dist'),
    candidateId,
    JSON.stringify(capabilityIds),
    now(),
  )
}

export function getDistinctiveProfile(candidateId: string): string[] | null {
  const row = getDb()
    .prepare('SELECT * FROM distinctive_profiles WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId) as unknown as { capability_ids: string } | undefined
  if (!row) return null
  return parseJsonArray(row.capability_ids)
}

export function insertIntent(row: Omit<IntentRow, 'created_at' | 'confirmed_at' | 'valid_until'>): IntentRow {
  const db = getDb()
  db.prepare(
    'INSERT INTO intent_profiles (id, candidate_id, raw_answer, groups, listening_for, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.candidate_id, row.raw_answer, row.groups, row.listening_for, now())
  return db.prepare('SELECT * FROM intent_profiles WHERE id = ?').get(row.id) as unknown as IntentRow
}

export function getLatestIntent(candidateId: string): IntentRow | undefined {
  return getDb()
    .prepare('SELECT * FROM intent_profiles WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId) as unknown as IntentRow | undefined
}

export function confirmIntent(id: string): void {
  const validUntil = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString()
  getDb()
    .prepare('UPDATE intent_profiles SET confirmed_at = ?, valid_until = ? WHERE id = ?')
    .run(now(), validUntil, id)
}

export { parseJsonArray }
