/**
 * Storage for Opportunity Zero.
 *
 * Kept apart from repo.ts on purpose. User Zero is frozen, and an experiment
 * that might be thrown away should not be threaded through the file that
 * holds the part that works.
 *
 * Every stage writes its own row and nothing overwrites an earlier one, so a
 * decision can always be walked back to the rubric it came from and the text
 * that arrived.
 */

import { getDb, queueWrite } from './db'
import { newId, now } from './repo'

export interface OpportunityRow {
  id: string
  candidate_id: string
  company: string
  role: string
  url: string | null
  raw_text: string
  /** 'manual' when pasted in, 'fixture' from the test set, 'manfred' from the feed. */
  provenance: string
  fixture_key: string | null
  /** The id the feed uses. Unique per candidate, so a resync brings it back rather than again. */
  source_ref: string | null
  status: string
  status_detail: string | null
  created_at: string
  updated_at: string
}

export interface RubricRow {
  id: string
  opportunity_id: string
  version: string
  rubric: string
  model_run_id: string | null
  latency_ms: number | null
  created_at: string
}

export interface AssessmentRow {
  id: string
  opportunity_id: string
  rubric_id: string
  version: string
  hard_constraints: string
  evidence_match: string
  intent_match: string
  unknowns: string
  intent_references: string
  model_run_id: string | null
  latency_ms: number | null
  created_at: string
}

export interface DecisionRow {
  id: string
  opportunity_id: string
  assessment_id: string
  version: string
  model_decision: string | null
  decision: string
  override_reason: string | null
  reason: string
  supporting_evidence_ids: string
  supporting_intent_refs: string
  material_unknowns: string
  next_action_type: string
  next_action_question: string | null
  explanation: string | null
  unsupported_claims: string
  model_run_id: string | null
  explanation_model_run_id: string | null
  latency_ms: number | null
  created_at: string
}

export interface LabelRow {
  id: string
  opportunity_id: string
  label: string
  comment: string | null
  origin: string
  created_at: string
}

export interface ResponseRow {
  id: string
  opportunity_id: string
  decision_id: string
  response: string
  created_at: string
}

export interface AuditEventRow {
  id: string
  candidate_id: string | null
  subject_type: string
  subject_id: string
  event: string
  detail: string | null
  model_run_id: string | null
  created_at: string
}

/** Where an opportunity has got to. Also what a retry uses to skip ahead. */
export type OpportunityStatus = 'received' | 'rubric' | 'matched' | 'decided' | 'failed'

// ─── Opportunities ────────────────────────────────────────────────────────

export function insertOpportunity(row: {
  candidate_id: string
  company: string
  role: string
  url: string | null
  raw_text: string
  provenance: string
  fixture_key?: string | null
  source_ref?: string | null
  /** Screened out before any model saw it, with the reason in status_detail. */
  status?: string
  status_detail?: string | null
}): OpportunityRow {
  const db = getDb()
  const id = newId('opp')
  const stamp = now()
  db.prepare(
    `INSERT INTO opportunities (id, candidate_id, company, role, url, raw_text, provenance, fixture_key, source_ref, status, status_detail, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.candidate_id,
    row.company,
    row.role,
    row.url,
    row.raw_text,
    row.provenance,
    row.fixture_key ?? null,
    row.source_ref ?? null,
    row.status ?? 'received',
    row.status_detail ?? null,
    stamp,
    stamp,
  )
  return getOpportunity(id) as OpportunityRow
}

export function getOpportunity(id: string): OpportunityRow | undefined {
  return getDb().prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as unknown as
    | OpportunityRow
    | undefined
}

export function listOpportunities(candidateId: string): OpportunityRow[] {
  return getDb()
    .prepare('SELECT * FROM opportunities WHERE candidate_id = ? ORDER BY created_at DESC')
    .all(candidateId) as unknown as OpportunityRow[]
}

/** So a fixture run twice does not leave two of everything behind. */
export function findOpportunityByFixtureKey(
  candidateId: string,
  fixtureKey: string,
): OpportunityRow | undefined {
  return getDb()
    .prepare('SELECT * FROM opportunities WHERE candidate_id = ? AND fixture_key = ?')
    .get(candidateId, fixtureKey) as unknown as OpportunityRow | undefined
}

/** The same offer arriving from the feed again is the same offer. */
/**
 * Las que pasaron la criba y nunca llegaron a decidirse.
 *
 * Un sondeo evalúa como mucho `maxEvaluations` por pasada, porque cada una
 * son tres llamadas y un minuto. Las que sobran se guardan en `received` — y
 * en la pasada siguiente se saltan por «ya conocida», así que se quedaban ahí
 * para siempre. Diez ofertas que habían superado el filtro y sobre las que
 * nunca se dijo nada, que es justo lo que este producto existe para no hacer.
 *
 * Las más antiguas primero: una oferta lleva viva lo que lleva, y la que
 * lleva más esperando es la que antes deja de estarlo.
 */
export function listUnevaluatedOpportunities(
  candidateId: string,
  provenance?: string,
): OpportunityRow[] {
  const sql = provenance
    ? `SELECT * FROM opportunities
       WHERE candidate_id = ? AND status = 'received' AND provenance = ?
       ORDER BY created_at ASC`
    : `SELECT * FROM opportunities
       WHERE candidate_id = ? AND status = 'received'
       ORDER BY created_at ASC`
  const args = provenance ? [candidateId, provenance] : [candidateId]
  return getDb().prepare(sql).all(...args) as unknown as OpportunityRow[]
}

export function findOpportunityBySourceRef(
  candidateId: string,
  sourceRef: string,
): OpportunityRow | undefined {
  return getDb()
    .prepare('SELECT * FROM opportunities WHERE candidate_id = ? AND source_ref = ?')
    .get(candidateId, sourceRef) as unknown as OpportunityRow | undefined
}

export function updateOpportunityStatus(
  id: string,
  status: OpportunityStatus,
  detail: string | null = null,
): void {
  getDb()
    .prepare('UPDATE opportunities SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?')
    .run(status, detail, now(), id)
}

// ─── Rubrics ──────────────────────────────────────────────────────────────

export function insertRubric(row: {
  opportunity_id: string
  version: string
  rubric: string
  model_run_id: string | null
  latency_ms: number | null
}): RubricRow {
  const db = getDb()
  const id = newId('rub')
  db.prepare(
    `INSERT INTO opportunity_rubrics (id, opportunity_id, version, rubric, model_run_id, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, row.opportunity_id, row.version, row.rubric, row.model_run_id, row.latency_ms, now())
  return db.prepare('SELECT * FROM opportunity_rubrics WHERE id = ?').get(id) as unknown as RubricRow
}

export function getLatestRubric(opportunityId: string): RubricRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM opportunity_rubrics WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(opportunityId) as unknown as RubricRow | undefined
}

// ─── Assessments ──────────────────────────────────────────────────────────

export function insertAssessment(row: {
  opportunity_id: string
  rubric_id: string
  version: string
  hard_constraints: string
  evidence_match: string
  intent_match: string
  unknowns: string
  intent_references: string
  model_run_id: string | null
  latency_ms: number | null
}): AssessmentRow {
  const db = getDb()
  const id = newId('asmt')
  db.prepare(
    `INSERT INTO opportunity_assessments (id, opportunity_id, rubric_id, version, hard_constraints, evidence_match, intent_match, unknowns, intent_references, model_run_id, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.opportunity_id,
    row.rubric_id,
    row.version,
    row.hard_constraints,
    row.evidence_match,
    row.intent_match,
    row.unknowns,
    row.intent_references,
    row.model_run_id,
    row.latency_ms,
    now(),
  )
  return db
    .prepare('SELECT * FROM opportunity_assessments WHERE id = ?')
    .get(id) as unknown as AssessmentRow
}

export function getLatestAssessment(opportunityId: string): AssessmentRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM opportunity_assessments WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(opportunityId) as unknown as AssessmentRow | undefined
}

// ─── Decisions ────────────────────────────────────────────────────────────

export function insertDecision(row: {
  opportunity_id: string
  assessment_id: string
  version: string
  model_decision: string | null
  decision: string
  override_reason: string | null
  reason: string
  supporting_evidence_ids: string
  supporting_intent_refs: string
  material_unknowns: string
  next_action_type: string
  next_action_question: string | null
  explanation: string | null
  unsupported_claims: string
  model_run_id: string | null
  explanation_model_run_id: string | null
  latency_ms: number | null
}): DecisionRow {
  const db = getDb()
  const id = newId('dec')
  db.prepare(
    `INSERT INTO opportunity_decisions (id, opportunity_id, assessment_id, version, model_decision, decision, override_reason, reason, supporting_evidence_ids, supporting_intent_refs, material_unknowns, next_action_type, next_action_question, explanation, unsupported_claims, model_run_id, explanation_model_run_id, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.opportunity_id,
    row.assessment_id,
    row.version,
    row.model_decision,
    row.decision,
    row.override_reason,
    row.reason,
    row.supporting_evidence_ids,
    row.supporting_intent_refs,
    row.material_unknowns,
    row.next_action_type,
    row.next_action_question,
    row.explanation,
    row.unsupported_claims,
    row.model_run_id,
    row.explanation_model_run_id,
    row.latency_ms,
    now(),
  )
  return db
    .prepare('SELECT * FROM opportunity_decisions WHERE id = ?')
    .get(id) as unknown as DecisionRow
}

export function getLatestDecision(opportunityId: string): DecisionRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM opportunity_decisions WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(opportunityId) as unknown as DecisionRow | undefined
}

/**
 * The one thing the candidate might be shown: an interruption that cleared
 * the bar and that they have not answered yet.
 *
 * HOLD and IGNORE never appear here, which is the point — they are answers,
 * not a queue of things to get through later.
 */
export function listPendingInterruptions(candidateId: string): {
  opportunity: OpportunityRow
  decision: DecisionRow
}[] {
  const rows = getDb()
    .prepare(
      `SELECT d.*, o.id AS o_id FROM opportunity_decisions d
       JOIN opportunities o ON o.id = d.opportunity_id
       LEFT JOIN opportunity_responses r ON r.decision_id = d.id
       WHERE o.candidate_id = ? AND d.decision = 'INTERRUPT' AND r.id IS NULL
       ORDER BY d.created_at DESC`,
    )
    .all(candidateId) as unknown as (DecisionRow & { o_id: string })[]

  const out: { opportunity: OpportunityRow; decision: DecisionRow }[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    // Only the newest decision per opportunity: a rerun leaves the old one in
    // place for the trace, and the candidate should not see it twice.
    if (seen.has(row.opportunity_id)) continue
    const latest = getLatestDecision(row.opportunity_id)
    if (!latest || latest.id !== row.id) continue
    const opportunity = getOpportunity(row.opportunity_id)
    if (!opportunity) continue
    seen.add(row.opportunity_id)
    out.push({ opportunity, decision: row })
  }
  return out
}

/**
 * The ones being held, newest first.
 *
 * HOLD is not a queue for the candidate — they never see these — but it is
 * the only part of the pipeline that a new fact can unstick. A hold means
 * the bar was not cleared with what was known at the time; something they
 * mentioned in passing afterwards is exactly the thing that might clear it.
 */
export function listHeldOpportunities(candidateId: string): {
  opportunity: OpportunityRow
  decision: DecisionRow
}[] {
  const rows = getDb()
    .prepare(
      `SELECT d.* FROM opportunity_decisions d
       JOIN opportunities o ON o.id = d.opportunity_id
       WHERE o.candidate_id = ? AND d.decision = 'HOLD'
       ORDER BY d.created_at DESC`,
    )
    .all(candidateId) as unknown as DecisionRow[]

  const out: { opportunity: OpportunityRow; decision: DecisionRow }[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.opportunity_id)) continue
    // Only where HOLD is still the standing answer: an opportunity held in
    // the morning and interrupted at noon is not on hold.
    const latest = getLatestDecision(row.opportunity_id)
    if (!latest || latest.id !== row.id) continue
    const opportunity = getOpportunity(row.opportunity_id)
    if (!opportunity) continue
    seen.add(row.opportunity_id)
    out.push({ opportunity, decision: row })
  }
  return out
}

// ─── The blind label, and the candidate's answer ──────────────────────────

/**
 * Written before Amble runs, and never read by anything that builds a
 * prompt. The separation is the experiment: a label the model can see is
 * not a blind label.
 */
export function insertLabel(row: {
  opportunity_id: string
  label: string
  comment: string | null
  origin: string
}): LabelRow {
  const db = getDb()
  const id = newId('lbl')
  db.prepare(
    `INSERT INTO opportunity_labels (id, opportunity_id, label, comment, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, row.opportunity_id, row.label, row.comment, row.origin, now())
  return db.prepare('SELECT * FROM opportunity_labels WHERE id = ?').get(id) as unknown as LabelRow
}

export function getLabel(opportunityId: string): LabelRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM opportunity_labels WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(opportunityId) as unknown as LabelRow | undefined
}

export function insertResponse(row: {
  opportunity_id: string
  decision_id: string
  response: string
}): ResponseRow {
  const db = getDb()
  const id = newId('resp')
  db.prepare(
    `INSERT INTO opportunity_responses (id, opportunity_id, decision_id, response, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, row.opportunity_id, row.decision_id, row.response, now())
  return db
    .prepare('SELECT * FROM opportunity_responses WHERE id = ?')
    .get(id) as unknown as ResponseRow
}

export function getResponse(opportunityId: string): ResponseRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM opportunity_responses WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(opportunityId) as unknown as ResponseRow | undefined
}

// ─── Audit ────────────────────────────────────────────────────────────────

/**
 * Append-only, and deliberately forgiving: an audit write must never be the
 * thing that breaks the step it was recording. Same reasoning as model runs,
 * and the same queueWrite behind it.
 */
export function recordAuditEvent(row: {
  candidate_id: string | null
  subject_type: string
  subject_id: string
  event: string
  detail?: unknown
  model_run_id?: string | null
}): void {
  queueWrite(() => {
    try {
      getDb()
        .prepare(
          `INSERT INTO audit_events (id, candidate_id, subject_type, subject_id, event, detail, model_run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId('aud'),
          row.candidate_id,
          row.subject_type,
          row.subject_id,
          row.event,
          row.detail === undefined ? null : JSON.stringify(row.detail).slice(0, 4000),
          row.model_run_id ?? null,
          now(),
        )
    } catch {
      // Never break the flow that produced it.
    }
  })
}

export function listAuditEvents(subjectType: string, subjectId: string): AuditEventRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM audit_events WHERE subject_type = ? AND subject_id = ? ORDER BY created_at ASC',
    )
    .all(subjectType, subjectId) as unknown as AuditEventRow[]
}

/** Model runs for the opportunity tasks, newest first. */
export function listOpportunityModelRuns(candidateId: string, limit = 200) {
  return getDb()
    .prepare(
      `SELECT * FROM model_runs WHERE candidate_id = ? AND task LIKE 'opportunity_%'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(candidateId, limit) as unknown as {
    id: string
    task: string
    task_version: string
    model_id: string | null
    latency_ms: number | null
    ok: number
    error: string | null
    created_at: string
  }[]
}

// ─── Questions the Rep needs answered ─────────────────────────────────────

export interface OpportunityQuestionRow {
  id: string
  candidate_id: string
  opportunity_id: string
  decision_id: string | null
  unknown_id: string | null
  question: string
  reason: string
  /** 'open' until answered, then 'answered'. 'dropped' when it stopped mattering. */
  status: string
  answer: string | null
  evidence_ids: string
  created_at: string
  answered_at: string | null
  /** Cuándo llegó al grafo. Null significa que todavía no, no que no vaya. */
  incorporated_at: string | null
  /** Cuándo salió en un mensaje, sola o acompañada. */
  notified_at: string | null
}

/**
 * Ask once. A re-evaluation that reaches the same gap finds the question
 * already there and returns it rather than asking the same thing twice —
 * which, from the other side, is the difference between a Rep and a form.
 */
export function insertQuestion(row: {
  candidate_id: string
  opportunity_id: string
  decision_id: string | null
  unknown_id: string | null
  question: string
  reason: string
}): { question: OpportunityQuestionRow; created: boolean } {
  const existing = getDb()
    .prepare('SELECT * FROM opportunity_questions WHERE opportunity_id = ? AND question = ?')
    .get(row.opportunity_id, row.question) as unknown as OpportunityQuestionRow | undefined
  if (existing) return { question: existing, created: false }

  const id = newId('oq')
  getDb()
    .prepare(
      `INSERT INTO opportunity_questions
         (id, candidate_id, opportunity_id, decision_id, unknown_id, question, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      id,
      row.candidate_id,
      row.opportunity_id,
      row.decision_id,
      row.unknown_id,
      row.question,
      row.reason,
      now(),
    )
  return { question: getQuestion(id) as OpportunityQuestionRow, created: true }
}

export function getQuestion(id: string): OpportunityQuestionRow | undefined {
  return getDb()
    .prepare('SELECT * FROM opportunity_questions WHERE id = ?')
    .get(id) as unknown as OpportunityQuestionRow | undefined
}

/** Oldest first: the one that has been waiting longest is the one to ask. */
export function listOpenQuestions(candidateId: string): OpportunityQuestionRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM opportunity_questions WHERE candidate_id = ? AND status = 'open' ORDER BY created_at",
    )
    .all(candidateId) as unknown as OpportunityQuestionRow[]
}

/**
 * Todo lo que ha contestado, en orden, sea de la oferta que sea.
 *
 * Las preguntas se hacen por oferta, pero las respuestas son sobre él: lo
 * que contó para una vale para la siguiente, y el agente que llegue después
 * tiene que saberlo antes de abrir la boca.
 */
export function listAnsweredQuestions(candidateId: string): OpportunityQuestionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM opportunity_questions
       WHERE candidate_id = ? AND status = 'answered' AND answer IS NOT NULL
       ORDER BY answered_at`,
    )
    .all(candidateId) as unknown as OpportunityQuestionRow[]
}

export function listQuestionsFor(opportunityId: string): OpportunityQuestionRow[] {
  return getDb()
    .prepare('SELECT * FROM opportunity_questions WHERE opportunity_id = ? ORDER BY created_at')
    .all(opportunityId) as unknown as OpportunityQuestionRow[]
}

export function recordQuestionAnswer(id: string, answer: string): void {
  getDb()
    .prepare(
      "UPDATE opportunity_questions SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?",
    )
    .run(answer, now(), id)
}

/** Ya ha salido en un mensaje: no vuelve a salir en el siguiente. */
export function markQuestionNotified(id: string): void {
  getDb().prepare('UPDATE opportunity_questions SET notified_at = ? WHERE id = ?').run(now(), id)
}

/** Abiertas y todavía sin avisar. Lo que entra en el próximo mensaje. */
export function listUnnotifiedQuestions(candidateId: string): OpportunityQuestionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM opportunity_questions
       WHERE candidate_id = ? AND status = 'open' AND notified_at IS NULL
       ORDER BY created_at`,
    )
    .all(candidateId) as unknown as OpportunityQuestionRow[]
}

/** Entró al grafo, y no vuelve a entrar. */
export function markQuestionIncorporated(id: string): void {
  getDb()
    .prepare('UPDATE opportunity_questions SET incorporated_at = ? WHERE id = ?')
    .run(now(), id)
}

export function recordQuestionEvidence(id: string, evidenceIds: string[]): void {
  getDb()
    .prepare('UPDATE opportunity_questions SET evidence_ids = ? WHERE id = ?')
    .run(JSON.stringify(evidenceIds), id)
}
