/**
 * What the Opportunity Zero lab and the Listening screen read.
 *
 * Two very different audiences out of the same rows. The lab gets
 * everything, including the blind label and the model's own proposal; the
 * candidate gets one interruption, its explanation, and nothing else —
 * no IGNORE, no HOLD, no queue of things to get through.
 */

import { getOrCreateCandidate, listCapabilities, listEvidence } from './db/repo'
import {
  getLabel,
  getLatestAssessment,
  getLatestDecision,
  getLatestRubric,
  getOpportunity,
  getResponse,
  listAuditEvents,
  listOpportunities,
  listOpportunityModelRuns,
  listPendingInterruptions,
} from './db/opportunities'
import { listNotifications } from './db/notifications'
import { queueStatus } from './pipeline/jobs'
import type {
  Decision,
  Explanation,
  HumanLabel,
  MatchAnalysis,
  OpportunityRubric,
  UnsupportedClaim,
} from '@/domains/opportunity/types'

export interface DecisionView {
  id: string
  decision: Decision
  modelDecision: Decision | null
  overrideReason: string | null
  reason: string
  supportingEvidenceIds: string[]
  supportingIntentRefs: string[]
  materialUnknowns: string[]
  nextBestAction: { type: string; question: string | null }
  explanation: Explanation | null
  unsupportedClaims: UnsupportedClaim[]
  createdAt: string
}

export interface OpportunityTraceItem {
  id: string
  company: string
  role: string
  url: string | null
  provenance: string
  fixtureKey: string | null
  status: string
  statusDetail: string | null
  createdAt: string
  rawTextChars: number
  /** Written before the run. Shown here, and nowhere a prompt is built. */
  humanLabel: { label: HumanLabel; comment: string | null; origin: string } | null
  rubric: OpportunityRubric | null
  analysis: MatchAnalysis | null
  decision: DecisionView | null
  response: string | null
  audit: { event: string; detail: unknown; modelRunId: string | null; at: string }[]
}

export interface DecisionMatrixCell {
  label: HumanLabel
  decision: Decision
  count: number
}

export interface OpportunityLabViewModel {
  /** Whether there is a Professional Graph to hold anything against at all. */
  graphReady: boolean
  capabilitiesCount: number
  evidenceCount: number
  opportunities: OpportunityTraceItem[]
  counts: {
    total: number
    decided: number
    IGNORE: number
    HOLD: number
    INTERRUPT: number
    overridden: number
    hardConstraintFailures: number
    materialUnknowns: number
    unsupportedClaims: number
  }
  matrix: DecisionMatrixCell[]
  /** What was sent, or why it was not. The promise was one message. */
  notifications: {
    id: string
    channel: string
    address: string | null
    status: string
    attempts: number
    lastError: string | null
    aboutId: string
    createdAt: string
    sentAt: string | null
  }[]
  modelRuns: {
    id: string
    task: string
    version: string
    model: string | null
    latencyMs: number | null
    ok: boolean
    error: string | null
    createdAt: string
  }[]
  queue: ReturnType<typeof queueStatus>
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function traceFor(opportunityId: string): Pick<
  OpportunityTraceItem,
  'rubric' | 'analysis' | 'decision' | 'humanLabel' | 'response' | 'audit'
> {
  const rubricRow = getLatestRubric(opportunityId)
  const assessmentRow = getLatestAssessment(opportunityId)
  const decisionRow = getLatestDecision(opportunityId)
  const labelRow = getLabel(opportunityId)
  const responseRow = getResponse(opportunityId)

  return {
    rubric: rubricRow ? parse<OpportunityRubric | null>(rubricRow.rubric, null) : null,
    analysis: assessmentRow
      ? {
          hardConstraints: parse(assessmentRow.hard_constraints, []),
          evidenceMatch: parse(assessmentRow.evidence_match, []),
          intentMatch: parse(assessmentRow.intent_match, []),
          unknowns: parse(assessmentRow.unknowns, []),
        }
      : null,
    decision: decisionRow
      ? {
          id: decisionRow.id,
          decision: decisionRow.decision as Decision,
          modelDecision: (decisionRow.model_decision as Decision | null) ?? null,
          overrideReason: decisionRow.override_reason,
          reason: decisionRow.reason,
          supportingEvidenceIds: parse(decisionRow.supporting_evidence_ids, []),
          supportingIntentRefs: parse(decisionRow.supporting_intent_refs, []),
          materialUnknowns: parse(decisionRow.material_unknowns, []),
          nextBestAction: {
            type: decisionRow.next_action_type,
            question: decisionRow.next_action_question,
          },
          explanation: parse<Explanation | null>(decisionRow.explanation, null),
          unsupportedClaims: parse<UnsupportedClaim[]>(decisionRow.unsupported_claims, []),
          createdAt: decisionRow.created_at,
        }
      : null,
    humanLabel: labelRow
      ? { label: labelRow.label as HumanLabel, comment: labelRow.comment, origin: labelRow.origin }
      : null,
    response: responseRow?.response ?? null,
    audit: listAuditEvents('opportunity', opportunityId).map((event) => ({
      event: event.event,
      detail: parse<unknown>(event.detail, null),
      modelRunId: event.model_run_id,
      at: event.created_at,
    })),
  }
}

export function getOpportunityLabViewModel(): OpportunityLabViewModel {
  const candidate = getOrCreateCandidate()
  const capabilities = listCapabilities(candidate.id)
  const evidence = listEvidence(candidate.id)

  const opportunities: OpportunityTraceItem[] = listOpportunities(candidate.id).map((row) => ({
    id: row.id,
    company: row.company,
    role: row.role,
    url: row.url,
    provenance: row.provenance,
    fixtureKey: row.fixture_key,
    status: row.status,
    statusDetail: row.status_detail,
    createdAt: row.created_at,
    rawTextChars: row.raw_text.length,
    ...traceFor(row.id),
  }))

  const decided = opportunities.filter((item) => item.decision !== null)
  const tally = (decision: Decision) =>
    decided.filter((item) => item.decision?.decision === decision).length

  const matrix: DecisionMatrixCell[] = []
  for (const label of ['YES', 'MAYBE', 'NO'] as HumanLabel[]) {
    for (const decision of ['INTERRUPT', 'HOLD', 'IGNORE'] as Decision[]) {
      matrix.push({
        label,
        decision,
        count: decided.filter(
          (item) => item.humanLabel?.label === label && item.decision?.decision === decision,
        ).length,
      })
    }
  }

  return {
    graphReady: capabilities.length > 0,
    capabilitiesCount: capabilities.length,
    evidenceCount: evidence.length,
    opportunities,
    counts: {
      total: opportunities.length,
      decided: decided.length,
      IGNORE: tally('IGNORE'),
      HOLD: tally('HOLD'),
      INTERRUPT: tally('INTERRUPT'),
      overridden: decided.filter((item) => item.decision?.overrideReason !== null).length,
      hardConstraintFailures: decided.reduce(
        (total, item) =>
          total +
          (item.analysis?.hardConstraints.filter((check) => check.verdict === 'FAIL').length ?? 0),
        0,
      ),
      materialUnknowns: decided.reduce(
        (total, item) => total + (item.decision?.materialUnknowns.length ?? 0),
        0,
      ),
      unsupportedClaims: decided.reduce(
        (total, item) => total + (item.decision?.unsupportedClaims.length ?? 0),
        0,
      ),
    },
    matrix,
    notifications: listNotifications(candidate.id).map((note) => ({
      id: note.id,
      channel: note.channel,
      address: note.address,
      status: note.status,
      attempts: note.attempts,
      lastError: note.last_error,
      aboutId: note.about_id,
      createdAt: note.created_at,
      sentAt: note.sent_at,
    })),
    modelRuns: listOpportunityModelRuns(candidate.id).map((run) => ({
      id: run.id,
      task: run.task,
      version: run.task_version,
      model: run.model_id,
      latencyMs: run.latency_ms,
      ok: run.ok === 1,
      error: run.error,
      createdAt: run.created_at,
    })),
    queue: queueStatus(candidate.id),
  }
}

// ─── What the candidate sees, if anything ─────────────────────────────────

export interface InterruptionView {
  opportunityId: string
  company: string
  role: string
  url: string | null
  headline: string
  whyShowing: string
  whyYou: { text: string; evidence: string[] }[]
  whatToConsider: string[]
  /** What the role is, only where the posting actually said so. */
  facts: { label: string; value: string }[]
}

/**
 * The one thing worth showing, or nothing.
 *
 * HOLD and IGNORE never reach here. That is not an oversight or a stage we
 * have not built yet — it is the product: silence is the normal answer, and
 * a "things we are still thinking about" list would give the work back to
 * the person Amble is supposed to be doing it for.
 */
export function getPendingInterruption(): InterruptionView | null {
  const candidate = getOrCreateCandidate()
  const pending = listPendingInterruptions(candidate.id)[0]
  return pending ? buildInterruption(candidate.id, pending.opportunity, pending.decision) : null
}

/**
 * The same view for one opportunity, answered or not.
 *
 * The message that goes out by email has to say what the screen says, word
 * for word — two versions of why someone is being interrupted is two
 * products. So both come through here.
 */
export function getInterruptionFor(opportunityId: string): InterruptionView | null {
  const opportunity = getOpportunity(opportunityId)
  if (!opportunity) return null
  const decision = getLatestDecision(opportunityId)
  if (!decision || decision.decision !== 'INTERRUPT') return null
  return buildInterruption(opportunity.candidate_id, opportunity, decision)
}

function buildInterruption(
  candidateId: string,
  opportunity: { id: string; company: string; role: string; url: string | null },
  decisionRow: { explanation: string | null },
): InterruptionView | null {
  const explanation = parse<Explanation | null>(decisionRow.explanation, null)
  if (!explanation) return null

  const evidenceById = new Map(listEvidence(candidateId).map((item) => [item.id, item.statement]))
  const rubricRow = getLatestRubric(opportunity.id)
  const rubric = rubricRow ? parse<OpportunityRubric | null>(rubricRow.rubric, null) : null

  const facts: { label: string; value: string }[] = []
  if (rubric) {
    const pay = rubric.compensation
    if (pay && pay.min !== null) {
      facts.push({
        label: 'Pays',
        value: `${pay.min.toLocaleString('en-GB')}${pay.max ? ` – ${pay.max.toLocaleString('en-GB')}` : ''} ${pay.currency ?? 'EUR'}`,
      })
    }
    if (rubric.equity) facts.push({ label: 'Equity', value: rubric.equity })
    if (rubric.workModel) {
      facts.push({
        label: 'Work',
        value:
          rubric.workModel === 'remote'
            ? 'Remote'
            : rubric.workModel === 'hybrid'
              ? 'Hybrid'
              : 'On-site',
      })
    }
    if (rubric.location) facts.push({ label: 'Based', value: rubric.location })
    if (rubric.companyStage) facts.push({ label: 'Stage', value: rubric.companyStage })
  }

  return {
    opportunityId: opportunity.id,
    company: opportunity.company,
    role: opportunity.role,
    url: opportunity.url,
    headline: explanation.headline,
    whyShowing: explanation.whyShowing.text,
    whyYou: explanation.whyYou.map((claim) => ({
      text: claim.text,
      // The evidence itself, not its id. Everything shown here is checkable
      // by the person it is about, which is the whole point of the Map.
      evidence: claim.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter((statement): statement is string => Boolean(statement)),
    })),
    whatToConsider: explanation.whatToConsider.map((item) => item.text),
    facts,
  }
}
