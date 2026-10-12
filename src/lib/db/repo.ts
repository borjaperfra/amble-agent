import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { DEFAULT_LOCALE, isLocale } from '../i18n/locale'

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
  setup_at: string | null
  // Since when the search is paused, until they resume it; null while it runs.
  search_paused_at?: string | null
  created_at: string
}

// The levels a language is spoken at, lowest first. From B2 up someone can
// work in it: a posting that requires it does not rule them out.
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number]
export interface StatedLanguage {
  code: string
  level: LanguageLevel
}
export const worksIn = (language: StatedLanguage) => LANGUAGE_LEVELS.indexOf(language.level) >= LANGUAGE_LEVELS.indexOf('B2')

// What they said about where they live and the languages they speak; null
// for what they have not said.
export interface StatedAbout {
  homeCountry: string | null
  languages: StatedLanguage[] | null
  // Countries beyond their own region they want offers from (ISO 3166-1
  // alpha-2: 'US'); null when they have not asked for any.
  openTo: string[] | null
}

export function getStatedAbout(candidateId: string): StatedAbout {
  const row = getDb().prepare('SELECT home_country, languages, open_countries FROM candidates WHERE id = ?').get(candidateId) as
    | { home_country: string | null; languages: string | null; open_countries: string | null }
    | undefined
  const list = <T>(raw: string | null | undefined, keep: (item: T) => boolean): T[] | null => {
    try {
      const parsed = raw ? (JSON.parse(raw) as T[]) : null
      const kept = Array.isArray(parsed) ? parsed.filter(keep) : []
      return kept.length > 0 ? kept : null
    } catch {
      return null
    }
  }
  return {
    homeCountry: row?.home_country ?? null,
    languages: list<StatedLanguage>(row?.languages, (item) => /^[a-z]{2}$/.test(item?.code ?? '') && LANGUAGE_LEVELS.includes(item.level)),
    openTo: list<string>(row?.open_countries, (code) => /^[A-Z]{2}$/.test(code)),
  }
}

export function setStatedAbout(candidateId: string, about: StatedAbout): void {
  getDb()
    .prepare('UPDATE candidates SET home_country = ?, languages = ?, open_countries = ? WHERE id = ?')
    .run(about.homeCountry, about.languages ? JSON.stringify(about.languages) : null, about.openTo?.length ? JSON.stringify(about.openTo) : null, candidateId)
}

export function isSearchPaused(candidateId: string): boolean {
  const row = getDb().prepare('SELECT search_paused_at FROM candidates WHERE id = ?').get(candidateId) as { search_paused_at: string | null } | undefined
  return Boolean(row?.search_paused_at)
}

// Paused until further notice, or running again. True when it changed.
export function setSearchPaused(candidateId: string, paused: boolean): boolean {
  const result = paused
    ? getDb().prepare('UPDATE candidates SET search_paused_at = ? WHERE id = ? AND search_paused_at IS NULL').run(now(), candidateId)
    : getDb().prepare('UPDATE candidates SET search_paused_at = NULL WHERE id = ? AND search_paused_at IS NOT NULL').run(candidateId)
  return result.changes > 0
}

// The name and language the candidate gave, the first time in. Their own
// name is never replaced by one read from a source.
export function completeSetup(id: string, name: string, locale: string): void {
  getDb()
    .prepare("UPDATE candidates SET name = ?, locale = ?, locale_source = 'chosen', setup_at = ? WHERE id = ?")
    .run(name, locale, now(), id)
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

// A new name for the Rep to use, given by them (on WhatsApp, after the setup).
export function setCandidateName(id: string, name: string): void {
  getDb().prepare('UPDATE candidates SET name = ? WHERE id = ?').run(name, id)
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
  planned_gaps: string | null
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
  // What the provider counted, when it says (usage in its reply).
  prompt_tokens?: number | null
  cached_tokens?: number | null
  completion_tokens?: number | null
  reasoning_tokens?: number | null
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

// What their documents and answers said, without what a CV they replaced said.
export function listClaims(candidateId: string): ClaimRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM claims WHERE candidate_id = ?
         AND (source_id IS NULL OR source_id NOT IN (SELECT id FROM sources WHERE status = 'replaced'))
       ORDER BY created_at ASC`,
    )
    .all(candidateId) as unknown as ClaimRow[]
}

// A newer CV replaces the ones read before it: what was taken from them is
// retracted (kept, with why, in retractions: append-only), and they no longer
// count. Capabilities are weighed again after, by whoever read the new one.
// The LinkedIn PDF, GitHub and their web are other sources, never replaced by a CV.
export function replaceOlderCvs(candidateId: string, newSourceId: string, reason: string): string[] {
  const added = (getDb().prepare('SELECT created_at FROM sources WHERE id = ?').get(newSourceId) as { created_at: string } | undefined)?.created_at
  if (!added) return []
  const db = getDb()
  const older = db
    // Only CVs read before this one was added: two shared at once are both kept.
    .prepare("SELECT id FROM sources WHERE candidate_id = ? AND type = 'cv' AND status = 'processed' AND id != ? AND processed_at < ?")
    .all(candidateId, newSourceId, added) as { id: string }[]
  if (older.length === 0) return []
  const evidenceOf = db.prepare(
    `SELECT id, statement, epistemic_state FROM evidence
     WHERE candidate_id = ? AND retracted_at IS NULL
       AND (source_id = ? OR claim_id IN (SELECT id FROM claims WHERE source_id = ?))`,
  )
  const retract = db.prepare('UPDATE evidence SET retracted_at = ?, retracted_reason = ?, updated_at = ? WHERE id = ?')
  const record = db.prepare(
    'INSERT INTO retractions (id, candidate_id, evidence_id, statement, question, answer, reason, turn_id, previous_state, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)',
  )
  const ts = now()
  for (const { id } of older) {
    for (const item of evidenceOf.all(candidateId, id, id) as { id: string; statement: string; epistemic_state: string }[]) {
      retract.run(ts, reason, ts, item.id)
      record.run(newId('ret'), candidateId, item.id, item.statement, reason, item.epistemic_state, ts)
    }
    db.prepare("UPDATE sources SET status = 'replaced' WHERE id = ?").run(id)
  }
  return older.map((row) => row.id)
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

// The voice of what the person reads on their profile (PERSON_FACING_RULES in
// src/lib/model/tasks.ts), in their language. Everything written from now on
// is in it; rows marked otherwise are rewritten once. v3: nothing marks the
// person's gender.
export const EXPLANATION_VOICE = 'v3'

export function explanationVoice(candidateId: string): string {
  const row = getDb().prepare('SELECT locale FROM candidates WHERE id = ?').get(candidateId) as { locale: string | null } | undefined
  return `${EXPLANATION_VOICE}@${isLocale(row?.locale) ? row.locale : DEFAULT_LOCALE}`
}

export function upsertCapability(candidateId: string, id: string, name: string, assessment: string, reason: string): void {
  getDb()
    .prepare(
      `INSERT INTO capabilities (id, candidate_id, name, assessment, reason, updated_at, written_for)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, candidate_id) DO UPDATE SET name = excluded.name, assessment = excluded.assessment, reason = excluded.reason, updated_at = excluded.updated_at, written_for = excluded.written_for`,
    )
    .run(id, candidateId, name, assessment, reason, now(), explanationVoice(candidateId))
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
    `INSERT INTO uncertainties (id, candidate_id, capability_id, description, reason, materiality, status, resolvable_by_interview, kind, created_at, written_for)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    explanationVoice(row.candidate_id),
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

export function setPlannedGaps(id: string, uncertaintyIds: string[]): void {
  getDb().prepare('UPDATE interviews SET planned_gaps = ? WHERE id = ?').run(JSON.stringify(uncertaintyIds), id)
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

// An answer the Rep could not take in is undone whole, so it can be given
// again: the answer, and the claims and evidence it had produced. Nothing else
// is written before the last model call of an answer.
export function undoTurnAnswer(turnId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM evidence WHERE interview_turn_id = ? AND claim_id IN (SELECT id FROM claims WHERE interview_turn_id = ?)').run(
    turnId,
    turnId,
  )
  db.prepare('DELETE FROM claims WHERE interview_turn_id = ?').run(turnId)
  db.prepare('UPDATE interview_turns SET answer = NULL, answered_at = NULL WHERE id = ?').run(turnId)
}

export function answerTurn(id: string, answer: string): void {
  getDb()
    .prepare('UPDATE interview_turns SET answer = ?, answered_at = ? WHERE id = ?')
    .run(answer, now(), id)
}

// An audit write must never break the flow that produced it.
export function insertModelRun(row: Omit<ModelRunRow, 'created_at'>): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO model_runs (id, candidate_id, task, task_version, provider, model_id, base_url, prompt_chars, output_chars, latency_ms, ok, error, raw_output,
           prompt_tokens, cached_tokens, completion_tokens, reasoning_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.prompt_tokens ?? null,
        row.cached_tokens ?? null,
        row.completion_tokens ?? null,
        row.reasoning_tokens ?? null,
        now(),
      )
  } catch {
    // The run happened; only its record is missing.
  }
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

// The last one written, confirmed or not: the one on the screen being reviewed.
export function getLatestIntent(candidateId: string): IntentRow | undefined {
  return getDb()
    .prepare('SELECT * FROM intent_profiles WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId) as unknown as IntentRow | undefined
}

// The last one they confirmed: what the Rep listens for. An answer written
// after it and not confirmed (left halfway, or still on the screen) changes
// nothing until they confirm it.
export function getCurrentIntent(candidateId: string): IntentRow | undefined {
  return getDb()
    .prepare('SELECT * FROM intent_profiles WHERE candidate_id = ? AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1')
    .get(candidateId) as unknown as IntentRow | undefined
}

// Confirmed as they left it: what they edited is what the Rep listens for.
export function confirmIntent(candidateId: string, id: string, groups?: { label: string; values: string[] }[]): boolean {
  const validUntil = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString()
  const db = getDb()
  if (groups) {
    const kept = groups
      .map((group) => ({ label: group.label, values: group.values.map((value) => value.trim()).filter(Boolean) }))
      .filter((group) => group.values.length > 0)
    db.prepare('UPDATE intent_profiles SET groups = ?, listening_for = ? WHERE id = ? AND candidate_id = ?').run(
      JSON.stringify(kept),
      // What they are not interested in is not something to listen for.
      JSON.stringify(kept.filter((group) => group.label !== 'Not interested in').flatMap((group) => group.values).slice(0, 8)),
      id,
      candidateId,
    )
  }
  const result = db.prepare('UPDATE intent_profiles SET confirmed_at = ?, valid_until = ? WHERE id = ? AND candidate_id = ?').run(now(), validUntil, id, candidateId)
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
  // Null for a rule they stated in conversation, with no triage behind it.
  triage_id: string | null
  kind: string
  statement: string
  label: string | null
  origin: string
  original_statement: string | null
  original_label: string | null
  revised_at: string | null
  // The rule as the person reads it; NULL on a rule written before, not yet
  // reworded (then the statement is shown). The statement is what the matcher reads.
  wording: string | null
  // Why amble believes it: the sample offers and what they answered.
  evidence: string | null
  declared: string | null
  evidence_probe_ids: string
  quote: string | null
  status: string
  model_run_id: string | null
  created_at: string
  decided_at: string | null
  // said | triage | chat | own; null on a rule written before it was kept.
  source: string | null
  // A rule from what they said: the answer (intent_profiles) it came from.
  intent_id: string | null
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
    'id' | 'created_at' | 'decided_at' | 'status' | 'origin' | 'original_statement' | 'original_label' | 'revised_at' | 'wording' | 'source' | 'intent_id'
  >[],
): RevealedPreferenceRow[] {
  const db = getDb()
  db.prepare("DELETE FROM revealed_preferences WHERE triage_id = ? AND status = 'proposed'").run(triageId)
  const insert = db.prepare(
    `INSERT INTO revealed_preferences (id, candidate_id, triage_id, kind, statement, wording, label, evidence, declared, evidence_probe_ids, quote, status, model_run_id, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, 'triage')`,
  )
  const ts = now()
  for (const row of rows) {
    insert.run(
      newId('rpr'),
      row.candidate_id,
      row.triage_id,
      row.kind,
      row.statement,
      // Written plainly from the start: what is read and what is matched on are the same.
      row.statement,
      row.label,
      row.evidence,
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

// Everyone the Rep listens for: something confirmed to listen for, a
// preference from their triage or an intent still current, and the search not
// paused. Oldest account first.
export function listListeningCandidateIds(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id FROM candidates c
       WHERE c.search_paused_at IS NULL AND (EXISTS (SELECT 1 FROM revealed_preferences p WHERE p.candidate_id = c.id AND p.status = 'confirmed')
          OR EXISTS (SELECT 1 FROM intent_profiles i WHERE i.candidate_id = c.id AND i.confirmed_at IS NOT NULL
                     AND (i.valid_until IS NULL OR i.valid_until > ?)))
       ORDER BY c.created_at ASC`,
    )
    .all(now()) as { id: string }[]
  return rows.map((row) => row.id)
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

// The first revision keeps what the analysis said; later ones only move the
// text. Their own words are the rule, as read and as matched on.
export function reviseRevealedPreference(id: string, statement: string, label: string | null): void {
  getDb()
    .prepare(
      `UPDATE revealed_preferences SET
         original_statement = COALESCE(original_statement, statement),
         original_label = COALESCE(original_label, label),
         statement = ?, wording = ?, label = ?, revised_at = ?
       WHERE id = ?`,
    )
    .run(statement, statement, label, now(), id)
}

// The plain wording of a rule written before (scripts/rewrite-rules.ts). Only
// a row still holding the statement that was reworded, and not reworded yet.
export function setRevealedPreferenceWording(id: string, statement: string, wording: string, evidence: string | null): boolean {
  const result = getDb()
    .prepare('UPDATE revealed_preferences SET wording = ?, evidence = ? WHERE id = ? AND statement = ? AND wording IS NULL')
    .run(wording, evidence, id, statement)
  return Number(result.changes) === 1
}

// Written by the candidate: confirmed by definition, and never replaced by a
// later re-analysis (which only replaces 'proposed' rows).
export function insertCandidatePreference(row: {
  candidateId: string
  triageId: string | null
  kind: string
  statement: string
  label: string | null
  evidenceProbeIds: string[]
  quote: string | null
  // chat: told on WhatsApp; own: written by them on the screen.
  source: 'chat' | 'own'
}): RevealedPreferenceRow {
  const id = newId('rpr')
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO revealed_preferences (id, candidate_id, triage_id, kind, statement, wording, label, origin, declared, evidence_probe_ids, quote, status, model_run_id, created_at, decided_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', NULL, ?, ?, 'confirmed', NULL, ?, ?, ?)`,
    )
    .run(id, row.candidateId, row.triageId, row.kind, row.statement, row.statement, row.label, JSON.stringify(row.evidenceProbeIds), row.quote, ts, ts, row.source)
  return getRevealedPreference(id) as RevealedPreferenceRow
}

// Whether the rules of this answer are written, and how many from what they
// said apply now: read before writing, so that reading what the Rep listens
// for writes nothing when nothing changed.
export function saidPreferencesState(candidateId: string, intentId: string): { written: boolean; active: number } {
  const db = getDb()
  const written = Boolean(db.prepare('SELECT 1 FROM revealed_preferences WHERE candidate_id = ? AND intent_id = ? LIMIT 1').get(candidateId, intentId))
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM revealed_preferences WHERE candidate_id = ? AND source = 'said' AND status IN ('confirmed', 'proposed')")
    .get(candidateId) as { n: number }
  return { written, active: Number(active.n) }
}

// The rules from what they said, for the answer they confirmed: written once
// per answer, as confirmed, decided when they confirmed it. The ones from an
// earlier answer are superseded (kept, not applied); a rule they said and
// then dropped or rejected one by one stays as they left it.
export function replaceSaidPreferences(
  candidateId: string,
  intentId: string,
  decidedAt: string,
  // `group`: what it is about, as they said it (Role, Location…), kept in `declared`.
  rows: { kind: string; statement: string; label: string; wording: string; group: string }[],
  // Confirmed again (with what they edited): its own rules are set aside too, and written anew.
  again = false,
): void {
  const db = getDb()
  if (!again && saidPreferencesState(candidateId, intentId).written) return
  db.prepare(
    "UPDATE revealed_preferences SET status = 'superseded' WHERE candidate_id = ? AND source = 'said' AND status IN ('confirmed', 'proposed')",
  ).run(candidateId)
  const insert = db.prepare(
    `INSERT INTO revealed_preferences (id, candidate_id, triage_id, kind, statement, wording, label, origin, declared, evidence_probe_ids, quote, status, model_run_id, created_at, decided_at, source, intent_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'candidate', ?, '[]', NULL, 'confirmed', NULL, ?, ?, 'said', ?)`,
  )
  const ts = now()
  for (const row of rows) insert.run(newId('rpr'), candidateId, row.kind, row.statement, row.wording, row.label, row.group, ts, decidedAt, intentId)
}

// A rule proposed from what they said turning an offer down: waits, as
// proposed, for their yes on /me/preferences. Their words are kept as the quote.
export function insertProposedPreference(row: {
  candidateId: string
  kind: string
  statement: string
  label: string | null
  quote: string
  modelRunId: string | null
  source: 'offer'
}): string {
  const id = newId('rpr')
  getDb()
    .prepare(
      `INSERT INTO revealed_preferences (id, candidate_id, triage_id, kind, statement, wording, label, origin, declared, evidence_probe_ids, quote, status, model_run_id, created_at, source)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'analysis', NULL, '[]', ?, 'proposed', ?, ?, ?)`,
    )
    .run(id, row.candidateId, row.kind, row.statement, row.statement, row.label, row.quote, row.modelRunId, now(), row.source)
  return id
}

// Proposals waiting for them that no triage owns (from an offer they turned down).
export function listProposedPreferences(candidateId: string): RevealedPreferenceRow[] {
  return getDb()
    .prepare("SELECT * FROM revealed_preferences WHERE candidate_id = ? AND status = 'proposed' AND triage_id IS NULL ORDER BY created_at ASC")
    .all(candidateId) as unknown as RevealedPreferenceRow[]
}

// They said it still holds: it counts from today again (listening.ts, isStale).
export function renewRevealedPreference(id: string): void {
  getDb().prepare("UPDATE revealed_preferences SET decided_at = ? WHERE id = ? AND status = 'confirmed'").run(now(), id)
}

export function decideRevealedPreference(id: string, status: 'confirmed' | 'rejected'): void {
  getDb().prepare('UPDATE revealed_preferences SET status = ?, decided_at = ? WHERE id = ?').run(status, now(), id)
}

export { parseJsonArray }
