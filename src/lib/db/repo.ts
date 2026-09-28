import { randomUUID } from 'node:crypto'
import { getDb, queueWrite } from './db'

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
  locale: string | null
  locale_source: string | null
  email: string | null
  role: 'owner' | 'member'
  created_at: string
}

export function getCandidateByEmail(email: string): CandidateRow | undefined {
  return getDb().prepare('SELECT * FROM candidates WHERE email = ?').get(email) as unknown as CandidateRow | undefined
}

// The owner's account signs in with this email.
export function setOwnerEmail(email: string): CandidateRow {
  const owner = getOrCreateCandidate()
  getDb().prepare("UPDATE candidates SET email = ?, role = 'owner' WHERE id = ?").run(email, owner.id)
  return getOrCreateCandidate()
}

export function setCandidateLocale(id: string, locale: string, source: 'chosen' | 'detected'): void {
  getDb().prepare('UPDATE candidates SET locale = ?, locale_source = ? WHERE id = ?').run(locale, source, id)
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
  attribution: string
  attribution_tool: string | null
  defence_status: string | null
  defence_turn_id: string | null
  retracted_at: string | null
  retracted_reason: string | null
  retracted_by_turn: string | null
  created_at: string
  updated_at: string
}

export interface RetractionRow {
  id: string
  candidate_id: string
  evidence_id: string
  statement: string
  question: string | null
  answer: string | null
  reason: string
  turn_id: string | null
  previous_state: string
  created_at: string
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
  kind: string
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
  kind: string
  target_evidence_ids: string
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

export function getCandidate(id: string): CandidateRow | undefined {
  return getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(id) as unknown as CandidateRow | undefined
}

// Every request acts for one candidate; one that does not exist is a bug, not
// an empty profile.
export function candidateById(id: string): CandidateRow {
  const candidate = getCandidate(id)
  if (!candidate) throw new Error(`Unknown candidate ${id}`)
  return candidate
}

// The owner's account: scripts and the scheduled pass act for it until
// listening runs for every candidate.
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

export function updateSourceType(id: string, type: string): void {
  getDb().prepare('UPDATE sources SET type = ? WHERE id = ?').run(type, id)
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

type EvidenceAttributionFields = 'attribution' | 'attribution_tool' | 'defence_status'
type EvidenceLifecycleFields = 'defence_turn_id' | 'retracted_at' | 'retracted_reason' | 'retracted_by_turn'

export function insertEvidence(
  row: Omit<
    EvidenceRow,
    'created_at' | 'updated_at' | 'corroborated_by' | 'contradicted_by' | EvidenceAttributionFields | EvidenceLifecycleFields
  > &
    Partial<Pick<EvidenceRow, EvidenceAttributionFields>>,
): EvidenceRow {
  const db = getDb()
  const ts = now()
  db.prepare(
    `INSERT INTO evidence (id, candidate_id, claim_id, statement, epistemic_state, source_type, source_id, source_excerpt, strength, confidence, candidate_confirmed, human_verified, interview_turn_id, attribution, attribution_tool, defence_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    row.attribution ?? 'sole',
    row.attribution_tool ?? null,
    row.defence_status ?? null,
    ts,
    ts,
  )
  return db.prepare('SELECT * FROM evidence WHERE id = ?').get(row.id) as unknown as EvidenceRow
}

// Retracted evidence is hidden from everything that assesses the candidate.
// It is never deleted: listAllEvidence and listRetractions keep the audit trail.
export function listEvidence(candidateId: string): EvidenceRow[] {
  return getDb()
    .prepare('SELECT * FROM evidence WHERE candidate_id = ? AND retracted_at IS NULL ORDER BY created_at ASC')
    .all(candidateId) as unknown as EvidenceRow[]
}

export function listAllEvidence(candidateId: string): EvidenceRow[] {
  return getDb()
    .prepare('SELECT * FROM evidence WHERE candidate_id = ? ORDER BY created_at ASC')
    .all(candidateId) as unknown as EvidenceRow[]
}

export function listUndefendedAssistedEvidence(candidateId: string): EvidenceRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM evidence
       WHERE candidate_id = ? AND epistemic_state = 'ASSISTED_CLAIM'
         AND defence_status = 'undefended' AND retracted_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all(candidateId) as unknown as EvidenceRow[]
}

export function getEvidence(id: string): EvidenceRow | undefined {
  return getDb().prepare('SELECT * FROM evidence WHERE id = ?').get(id) as unknown as EvidenceRow | undefined
}

// Defended: the candidate showed the judgment is theirs. The evidence becomes
// their claim; attribution stays 'assisted' because the artifact still is.
export function markEvidenceDefended(id: string, turnId: string): void {
  getDb()
    .prepare(
      `UPDATE evidence SET epistemic_state = 'USER_CLAIM', defence_status = 'defended', defence_turn_id = ?,
         candidate_confirmed = 1, strength = 'some', updated_at = ? WHERE id = ?`,
    )
    .run(turnId, now(), id)
}

export function markEvidencePartial(id: string, turnId: string): void {
  getDb()
    .prepare(`UPDATE evidence SET defence_status = 'partial', defence_turn_id = ?, updated_at = ? WHERE id = ?`)
    .run(turnId, now(), id)
}

export function retractEvidence(params: {
  evidence: EvidenceRow
  reason: string
  question: string | null
  answer: string | null
  turnId: string | null
}): void {
  const db = getDb()
  const ts = now()
  const { evidence } = params
  db.prepare(
    `INSERT INTO retractions (id, candidate_id, evidence_id, statement, question, answer, reason, turn_id, previous_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('ret'),
    evidence.candidate_id,
    evidence.id,
    evidence.statement,
    params.question,
    params.answer,
    params.reason,
    params.turnId,
    evidence.epistemic_state,
    ts,
  )
  db.prepare(
    `UPDATE evidence SET defence_status = CASE WHEN defence_status IS NULL THEN NULL ELSE 'failed' END,
       defence_turn_id = COALESCE(?, defence_turn_id), retracted_at = ?, retracted_reason = ?, retracted_by_turn = ?, updated_at = ?
     WHERE id = ?`,
  ).run(params.turnId, ts, params.reason, params.turnId, ts, evidence.id)
  // The link is derived state, rebuilt by every assessment; the evidence row and
  // its retraction record are what the audit trail keeps.
  db.prepare('DELETE FROM capability_evidence WHERE evidence_id = ?').run(evidence.id)
}

export interface CareerDocumentRow {
  id: string
  candidate_id: string
  version: number
  markdown: string
  stats: string
  model_run_id: string | null
  created_at: string
}

export function insertCareerDocument(params: {
  candidateId: string
  markdown: string
  stats: unknown
  modelRunId: string | null
}): CareerDocumentRow {
  const db = getDb()
  const id = newId('car')
  // Version assigned in the same statement as the insert, so two builds cannot
  // claim the same number.
  db.prepare(
    `INSERT INTO career_documents (id, candidate_id, version, markdown, stats, model_run_id, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM career_documents WHERE candidate_id = ?), ?, ?, ?, ?)`,
  ).run(id, params.candidateId, params.candidateId, params.markdown, JSON.stringify(params.stats), params.modelRunId, now())
  return db.prepare('SELECT * FROM career_documents WHERE id = ?').get(id) as unknown as CareerDocumentRow
}

export function getCareerDocument(candidateId: string, version?: number): CareerDocumentRow | undefined {
  const db = getDb()
  if (version !== undefined) {
    return db
      .prepare('SELECT * FROM career_documents WHERE candidate_id = ? AND version = ?')
      .get(candidateId, version) as unknown as CareerDocumentRow | undefined
  }
  return db
    .prepare('SELECT * FROM career_documents WHERE candidate_id = ? ORDER BY version DESC LIMIT 1')
    .get(candidateId) as unknown as CareerDocumentRow | undefined
}

export function listCareerDocumentVersions(
  candidateId: string,
): Pick<CareerDocumentRow, 'version' | 'stats' | 'model_run_id' | 'created_at'>[] {
  return getDb()
    .prepare(
      'SELECT version, stats, model_run_id, created_at FROM career_documents WHERE candidate_id = ? ORDER BY version DESC',
    )
    .all(candidateId) as unknown as Pick<CareerDocumentRow, 'version' | 'stats' | 'model_run_id' | 'created_at'>[]
}

export function listRetractions(candidateId: string): RetractionRow[] {
  return getDb()
    .prepare('SELECT * FROM retractions WHERE candidate_id = ? ORDER BY created_at ASC')
    .all(candidateId) as unknown as RetractionRow[]
}

export function listEvidenceForCapabilities(candidateId: string, capabilityIds: string[]): EvidenceRow[] {
  if (capabilityIds.length === 0) return []
  const db = getDb()
  const placeholders = capabilityIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT DISTINCT e.* FROM evidence e
       JOIN capability_evidence ce ON ce.evidence_id = e.id
       WHERE e.candidate_id = ? AND e.retracted_at IS NULL AND ce.capability_id IN (${placeholders})
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

export function insertUncertainty(
  row: Omit<UncertaintyRow, 'created_at' | 'resolved_at' | 'resolved_by_turn' | 'kind'> & {
    kind?: 'MATERIALITY' | 'ATTRIBUTION'
  },
): UncertaintyRow {
  const db = getDb()
  db.prepare(
    `INSERT INTO uncertainties (id, candidate_id, capability_id, description, reason, materiality, status, resolvable_by_interview, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.candidate_id,
    row.capability_id,
    row.description,
    row.reason,
    row.materiality,
    row.status,
    row.resolvable_by_interview,
    row.kind ?? 'MATERIALITY',
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

export function insertTurn(
  row: Omit<InterviewTurnRow, 'created_at' | 'answered_at' | 'answer' | 'kind' | 'target_evidence_ids'> &
    Partial<Pick<InterviewTurnRow, 'kind' | 'target_evidence_ids'>>,
): InterviewTurnRow {
  const db = getDb()
  db.prepare(
    `INSERT INTO interview_turns (id, interview_id, idx, question, question_reason, target_capability_ids, target_uncertainty_ids, kind, target_evidence_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.interview_id,
    row.idx,
    row.question,
    row.question_reason,
    row.target_capability_ids,
    row.target_uncertainty_ids,
    row.kind ?? 'gap',
    row.target_evidence_ids ?? '[]',
    now(),
  )
  return db.prepare('SELECT * FROM interview_turns WHERE id = ?').get(row.id) as unknown as InterviewTurnRow
}

export function getTurn(id: string): InterviewTurnRow | undefined {
  return getDb().prepare('SELECT * FROM interview_turns WHERE id = ?').get(id) as unknown as InterviewTurnRow | undefined
}

export function ownsTurn(candidateId: string, turnId: string): boolean {
  return (
    getDb()
      .prepare('SELECT 1 FROM interview_turns t JOIN interviews i ON i.id = t.interview_id WHERE t.id = ? AND i.candidate_id = ?')
      .get(turnId, candidateId) !== undefined
  )
}

export function ownsCapability(candidateId: string, capabilityId: string): boolean {
  return getDb().prepare('SELECT 1 FROM capabilities WHERE id = ? AND candidate_id = ?').get(capabilityId, candidateId) !== undefined
}

export function answerTurn(id: string, answer: string): void {
  getDb()
    .prepare('UPDATE interview_turns SET answer = ?, answered_at = ? WHERE id = ?')
    .run(answer, now(), id)
}

export function insertModelRun(row: Omit<ModelRunRow, 'created_at'>): void {
  queueWrite(() =>
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
      ),
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

export function confirmIntent(candidateId: string, id: string): boolean {
  const validUntil = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString()
  const result = getDb()
    .prepare('UPDATE intent_profiles SET confirmed_at = ?, valid_until = ? WHERE id = ? AND candidate_id = ?')
    .run(now(), validUntil, id, candidateId)
  return Number(result.changes) > 0
}

export interface OfferTriageRow {
  id: string
  candidate_id: string
  method: string | null
  declared: string | null
  status: string
  created_at: string
  analysed_at: string | null
}

export interface OfferProbeRow {
  id: string
  triage_id: string
  candidate_id: string
  idx: number
  title: string
  description: string
  salary_eur: number | null
  attributes: string
  axes: string
  is_status_quo: number
  verdict: string | null
  conditions: string | null
  reason: string | null
  answered_at: string | null
  created_at: string
}

export interface RevealedPreferenceRow {
  id: string
  candidate_id: string
  triage_id: string
  kind: string
  statement: string
  label: string | null
  origin: string
  original_statement: string | null
  original_label: string | null
  revised_at: string | null
  declared: string | null
  evidence_probe_ids: string
  quote: string | null
  status: string
  model_run_id: string | null
  created_at: string
  decided_at: string | null
}

export function insertOfferTriage(params: {
  candidateId: string
  method: string | null
  declared: string | null
  probes: {
    title: string
    description: string
    salaryEur: number | null
    attributes: Record<string, unknown>
    axes: string[]
    isStatusQuo: boolean
  }[]
}): OfferTriageRow {
  const db = getDb()
  const id = newId('tri')
  const ts = now()
  db.prepare(
    'INSERT INTO offer_triages (id, candidate_id, method, declared, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, params.candidateId, params.method, params.declared, 'open', ts)
  const insert = db.prepare(
    `INSERT INTO offer_probes (id, triage_id, candidate_id, idx, title, description, salary_eur, attributes, axes, is_status_quo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  params.probes.forEach((probe, idx) => {
    insert.run(
      newId('prb'),
      id,
      params.candidateId,
      idx,
      probe.title,
      probe.description,
      probe.salaryEur,
      JSON.stringify(probe.attributes),
      JSON.stringify(probe.axes),
      probe.isStatusQuo ? 1 : 0,
      ts,
    )
  })
  return db.prepare('SELECT * FROM offer_triages WHERE id = ?').get(id) as unknown as OfferTriageRow
}

export function getLatestOfferTriage(candidateId: string): OfferTriageRow | undefined {
  return getDb()
    .prepare('SELECT * FROM offer_triages WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId) as unknown as OfferTriageRow | undefined
}

export function getOfferTriage(id: string): OfferTriageRow | undefined {
  return getDb().prepare('SELECT * FROM offer_triages WHERE id = ?').get(id) as unknown as OfferTriageRow | undefined
}

export function listOfferProbes(triageId: string): OfferProbeRow[] {
  return getDb()
    .prepare('SELECT * FROM offer_probes WHERE triage_id = ? ORDER BY idx ASC')
    .all(triageId) as unknown as OfferProbeRow[]
}

export function getOfferProbe(id: string): OfferProbeRow | undefined {
  return getDb().prepare('SELECT * FROM offer_probes WHERE id = ?').get(id) as unknown as OfferProbeRow | undefined
}

export function answerOfferProbe(id: string, verdict: string, conditions: string | null, reason: string | null): void {
  getDb()
    .prepare('UPDATE offer_probes SET verdict = ?, conditions = ?, reason = ?, answered_at = ? WHERE id = ?')
    .run(verdict, conditions, reason, now(), id)
}

export function updateOfferTriageStatus(id: string, status: string): void {
  getDb()
    .prepare('UPDATE offer_triages SET status = ?, analysed_at = CASE WHEN ? = \'analysed\' THEN ? ELSE analysed_at END WHERE id = ?')
    .run(status, status, now(), id)
}

// A re-analysis replaces the proposals it made, never what the candidate decided.
export function replaceProposedPreferences(
  triageId: string,
  rows: Omit<
    RevealedPreferenceRow,
    'id' | 'created_at' | 'decided_at' | 'status' | 'origin' | 'original_statement' | 'original_label' | 'revised_at'
  >[],
): RevealedPreferenceRow[] {
  const db = getDb()
  db.prepare("DELETE FROM revealed_preferences WHERE triage_id = ? AND status = 'proposed'").run(triageId)
  const insert = db.prepare(
    `INSERT INTO revealed_preferences (id, candidate_id, triage_id, kind, statement, label, declared, evidence_probe_ids, quote, status, model_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
  )
  const ts = now()
  for (const row of rows) {
    insert.run(
      newId('rpr'),
      row.candidate_id,
      row.triage_id,
      row.kind,
      row.statement,
      row.label,
      row.declared,
      row.evidence_probe_ids,
      row.quote,
      row.model_run_id,
      ts,
    )
  }
  return listRevealedPreferences(triageId)
}

export function listRevealedPreferences(triageId: string): RevealedPreferenceRow[] {
  return getDb()
    .prepare('SELECT * FROM revealed_preferences WHERE triage_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(triageId) as unknown as RevealedPreferenceRow[]
}

export function listConfirmedPreferences(candidateId: string): RevealedPreferenceRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM revealed_preferences WHERE candidate_id = ? AND status = 'confirmed' ORDER BY decided_at DESC",
    )
    .all(candidateId) as unknown as RevealedPreferenceRow[]
}

export function getRevealedPreference(id: string): RevealedPreferenceRow | undefined {
  return getDb()
    .prepare('SELECT * FROM revealed_preferences WHERE id = ?')
    .get(id) as unknown as RevealedPreferenceRow | undefined
}

// The first revision keeps what the analysis said; later ones only move the text.
export function reviseRevealedPreference(id: string, statement: string, label: string | null): void {
  getDb()
    .prepare(
      `UPDATE revealed_preferences SET
         original_statement = COALESCE(original_statement, statement),
         original_label = COALESCE(original_label, label),
         statement = ?, label = ?, revised_at = ?
       WHERE id = ?`,
    )
    .run(statement, label, now(), id)
}

// Written by the candidate: confirmed by definition, and never replaced by a
// later re-analysis (which only replaces 'proposed' rows).
export function insertCandidatePreference(row: {
  candidateId: string
  triageId: string
  kind: string
  statement: string
  label: string | null
  evidenceProbeIds: string[]
  quote: string | null
}): RevealedPreferenceRow {
  const id = newId('rpr')
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO revealed_preferences (id, candidate_id, triage_id, kind, statement, label, origin, declared, evidence_probe_ids, quote, status, model_run_id, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, 'candidate', NULL, ?, ?, 'confirmed', NULL, ?, ?)`,
    )
    .run(id, row.candidateId, row.triageId, row.kind, row.statement, row.label, JSON.stringify(row.evidenceProbeIds), row.quote, ts, ts)
  return getRevealedPreference(id) as RevealedPreferenceRow
}

export function decideRevealedPreference(id: string, status: 'confirmed' | 'rejected'): void {
  getDb().prepare('UPDATE revealed_preferences SET status = ?, decided_at = ? WHERE id = ?').run(status, now(), id)
}

export { parseJsonArray }
