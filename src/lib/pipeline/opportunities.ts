/**
 * Opportunity Zero — the pipeline.
 *
 *   RAW OPPORTUNITY → RUBRIC → MATCH → DECISION → (INTERRUPT only) EXPLANATION
 *
 * It runs on the queue rather than inside a request, for the same reason the
 * CV does: the work takes a minute, the phone does not stay awake for a
 * minute, and a stage that only exists inside a running process dies with
 * the request that started it. Each stage writes its row before the next one
 * starts, so a retry after a dropped connection picks up where it stopped
 * instead of paying for the rubric again.
 *
 * The model proposes at every stage. Domain rules in
 * `@/domains/opportunity/rules` decide, and both are kept.
 */

import {
  getLatestIntent,
  listCapabilities,
  listCapabilityEvidenceIds,
  listEvidence,
  listAnsweredTurns,
  listUncertainties,
  parseJsonArray,
} from '../db/repo'
import {
  getLabel,
  getLatestAssessment,
  getLatestDecision,
  getLatestRubric,
  getOpportunity,
  insertAssessment,
  insertDecision,
  insertOpportunity,
  insertLabel,
  insertRubric,
  insertResponse,
  listAnsweredQuestions,
  recordAuditEvent,
  updateOpportunityStatus,
  type OpportunityRow,
} from '../db/opportunities'
import { getQuestionBatchMs } from '@/lib/features'
import { readPreferences } from './preferences'
import { stripInternalIds } from '../model/tasks'
import {
  runInterruptionDecisionTask,
  runOpportunityExplanationTask,
  runOpportunityMatchTask,
  runOpportunityRubricTask,
} from '../model/opportunity-tasks'
import {
  buildDecisionPrompt,
  buildExplanationPrompt,
  buildMatchPrompt,
  buildRubricPrompt,
  DECISION_VERSION,
  EXPLANATION_VERSION,
  MATCH_VERSION,
  RUBRIC_VERSION,
  type CapabilityForMatch,
  type EvidenceForMatch,
  type Prompt,
} from '@/domains/opportunity/prompts'
import {
  auditExplanation,
  intentReferencesFrom,
  settleDecision,
  validateAnalysis,
  type CandidateSide,
} from '@/domains/opportunity/rules'
import type {
  CandidateResponse,
  Decision,
  Explanation,
  HumanLabel,
  InterruptionDecision,
  MatchAnalysis,
  OpportunityRubric,
  UnsupportedClaim,
} from '@/domains/opportunity/types'

// ─── The candidate side, assembled once per run ───────────────────────────

export interface CandidateContext {
  side: CandidateSide
  capabilities: CapabilityForMatch[]
  evidence: EvidenceForMatch[]
  openUncertainties: { id: string; description: string; materiality: string }[]
  /**
   * Lo que ya ha contestado, con sus palabras.
   *
   * Forma parte del perfil igual que la evidencia: si lo contó una vez, el
   * agente de la siguiente oferta ya lo sabe. Sin esto cada oferta razona
   * desde cero y vuelve al mismo hueco — medido en real, cinco de ocho
   * preguntas eran la misma y dos llegaron después de contestarla.
   */
  alreadyTold: { question: string; answer: string }[]
}

/**
 * Everything the match stage is allowed to know about the person.
 *
 * Note what is not in here: the CV, the source documents, the raw interview
 * answers. The graph exists precisely so that matching reads assessed
 * evidence rather than prose, and a capability claim can be pointed at.
 */
export function candidateContext(candidateId: string): CandidateContext {
  const capabilityEvidence = listCapabilityEvidenceIds(candidateId)
  const evidence = listEvidence(candidateId)
  const intent = getLatestIntent(candidateId)
  const preferences = readPreferences(candidateId)

  const groups = intent
    ? (JSON.parse(intent.groups) as { label: string; values: string[] }[]).filter(
        (group) => Array.isArray(group?.values),
      )
    : []

  const capabilities: CapabilityForMatch[] = listCapabilities(candidateId).map((capability) => ({
    id: capability.id,
    name: capability.name,
    assessment: capability.assessment,
    reason: capability.reason,
    evidenceIds: capabilityEvidence.get(capability.id) ?? [],
  }))

  return {
    side: {
      constraints: {
        salaryMin: preferences.salaryMin,
        salaryCurrency: preferences.salaryCurrency,
        workMode: preferences.workMode,
        location: preferences.location,
        technologies: preferences.technologies,
        stages: preferences.stages,
      },
      intentReferences: intentReferencesFrom({
        groups,
        listeningFor: intent ? parseJsonArray(intent.listening_for) : [],
        constraints: {
          salaryMin: preferences.salaryMin,
          salaryCurrency: preferences.salaryCurrency,
          workMode: preferences.workMode,
          location: preferences.location,
          technologies: preferences.technologies,
          stages: preferences.stages,
        },
      }),
      evidenceIds: evidence.map((item) => item.id),
      capabilityIds: capabilities.map((capability) => capability.id),
    },
    capabilities,
    evidence: evidence.slice(0, 120).map((item) => ({
      id: item.id,
      statement: item.statement,
      epistemicState: item.epistemic_state,
      sourceType: item.source_type,
      confirmed: item.candidate_confirmed === 1,
    })),
    openUncertainties: listUncertainties(candidateId, 'OPEN').map((item) => ({
      id: item.id,
      description: item.description,
      materiality: item.materiality,
    })),
    alreadyTold: answeredQuestions(candidateId),
  }
}

/**
 * Lo que ya le hemos preguntado y ha contestado.
 *
 * Recortado: una respuesta suya de hace tres meses sigue contando, pero un
 * prompt con cuarenta respuestas enteras deja de leerse. Las veinte últimas
 * y mil caracteres cada una es de sobra para que nadie repita una pregunta.
 */
export function answeredQuestions(
  candidateId: string,
): { question: string; answer: string }[] {
  // La entrevista cuenta igual. Lo que contó el primer día es tan suyo como
  // lo que contestó ayer por Telegram, y preguntárselo otra vez porque venía
  // de otra pantalla es exactamente lo que no puede pasar.
  const fromInterview = listAnsweredTurns(candidateId).map((turn) => ({
    question: turn.question ?? '',
    answer: (turn.answer ?? '').slice(0, 1000),
  }))
  const fromOffers = listAnsweredQuestions(candidateId).map((row) => ({
    question: row.question,
    answer: (row.answer ?? '').slice(0, 1000),
  }))

  return [...fromInterview, ...fromOffers].filter((item) => item.question.length > 0).slice(-30)
}

// ─── Ingestion ────────────────────────────────────────────────────────────

export interface IngestInput {
  candidateId: string
  company: string
  role: string
  url?: string | null
  rawText: string
  provenance: 'manual' | 'fixture'
  fixtureKey?: string | null
  /** Written before Amble runs, and stored where no prompt builder can reach it. */
  label?: { label: HumanLabel; comment?: string | null } | null
}

export function ingestOpportunity(input: IngestInput): OpportunityRow {
  const opportunity = insertOpportunity({
    candidate_id: input.candidateId,
    company: input.company,
    role: input.role,
    url: input.url ?? null,
    raw_text: input.rawText,
    provenance: input.provenance,
    fixture_key: input.fixtureKey ?? null,
  })

  if (input.label) {
    insertLabel({
      opportunity_id: opportunity.id,
      label: input.label.label,
      comment: input.label.comment?.trim() || null,
      origin: input.provenance === 'fixture' ? 'fixture' : 'human',
    })
  }

  recordAuditEvent({
    candidate_id: input.candidateId,
    subject_type: 'opportunity',
    subject_id: opportunity.id,
    event: 'opportunity_received',
    detail: {
      company: input.company,
      role: input.role,
      chars: input.rawText.length,
      provenance: input.provenance,
      // That a label exists is auditable. What it says is not: the point of
      // recording it is to compare against the answer, not to inform it.
      labelled: Boolean(input.label),
    },
  })

  return opportunity
}

// ─── The stages ───────────────────────────────────────────────────────────

/**
 * The model calls, injectable so the rules can be tested without a provider
 * and without a network. Nothing else in here is stubbed: the validation,
 * the decision and the audit are the things under test.
 */
export interface OpportunityRunners {
  rubric: typeof runOpportunityRubricTask
  match: typeof runOpportunityMatchTask
  decision: typeof runInterruptionDecisionTask
  explanation: typeof runOpportunityExplanationTask
}

const defaultRunners: OpportunityRunners = {
  rubric: runOpportunityRubricTask,
  match: runOpportunityMatchTask,
  decision: runInterruptionDecisionTask,
  explanation: runOpportunityExplanationTask,
}

export interface EvaluationResult {
  opportunityId: string
  decision: Decision
  modelDecision: Decision | null
  overrideReason: string | null
  unsupportedClaims: number
  /** Stages this run actually executed, as opposed to picked up from disk. */
  ran: string[]
}

export interface EvaluateOptions {
  /**
   * Read the person again, keeping the posting's rubric.
   *
   * Used after they answer a question: the job has not changed, they have.
   * Paying for the rubric a second time would be paying to read the same
   * document twice.
   */
  reassess?: boolean
}

export async function evaluateOpportunity(
  opportunityId: string,
  runners: OpportunityRunners = defaultRunners,
  options: EvaluateOptions = {},
): Promise<EvaluationResult> {
  const opportunity = getOpportunity(opportunityId)
  if (!opportunity) throw new Error(`Opportunity ${opportunityId} is gone.`)
  const candidateId = opportunity.candidate_id
  const ran: string[] = []

  // ── Stage 1: the rubric ────────────────────────────────────────────────
  let rubricRow = getLatestRubric(opportunityId)
  if (!rubricRow) {
    const { data, modelRunId, latencyMs } = await runners.rubric({
      candidateId,
      opportunity: {
        company: opportunity.company,
        role: opportunity.role,
        url: opportunity.url,
        rawText: opportunity.raw_text,
      },
    })
    rubricRow = insertRubric({
      opportunity_id: opportunityId,
      version: RUBRIC_VERSION,
      rubric: JSON.stringify(data),
      model_run_id: modelRunId,
      latency_ms: latencyMs,
    })
    updateOpportunityStatus(opportunityId, 'rubric')
    ran.push('rubric')
    recordAuditEvent({
      candidate_id: candidateId,
      subject_type: 'opportunity',
      subject_id: opportunityId,
      event: 'rubric_extracted',
      model_run_id: modelRunId,
      detail: {
        requirements: data.requirements.length,
        unknownAttributes: unknownAttributesOf(data),
        latencyMs,
      },
    })
  }

  const rubric = JSON.parse(rubricRow.rubric) as OpportunityRubric
  const context = candidateContext(candidateId)

  // ── Stage 2: the four readings ─────────────────────────────────────────
  let assessmentRow = options.reassess ? undefined : getLatestAssessment(opportunityId)
  if (!assessmentRow) {
    const { data, modelRunId, latencyMs } = await runners.match({
      candidateId,
      input: {
        alreadyTold: context.alreadyTold,
        opportunity: { company: opportunity.company, role: opportunity.role },
        rubric,
        capabilities: context.capabilities,
        evidence: context.evidence,
        openUncertainties: context.openUncertainties,
        intentReferences: context.side.intentReferences,
      },
    })

    const proposed = {
      hardConstraints: data.hardConstraints,
      evidenceMatch: data.evidenceMatch,
      intentMatch: data.intentMatch,
      unknowns: data.unknowns,
    }
    const analysis = validateAnalysis(proposed, context.side, rubric)

    assessmentRow = insertAssessment({
      opportunity_id: opportunityId,
      rubric_id: rubricRow.id,
      version: MATCH_VERSION,
      hard_constraints: JSON.stringify(analysis.hardConstraints),
      evidence_match: JSON.stringify(analysis.evidenceMatch),
      intent_match: JSON.stringify(analysis.intentMatch),
      unknowns: JSON.stringify(analysis.unknowns),
      intent_references: JSON.stringify(context.side.intentReferences),
      model_run_id: modelRunId,
      latency_ms: latencyMs,
    })
    updateOpportunityStatus(opportunityId, 'matched')
    ran.push('match')
    recordAuditEvent({
      candidate_id: candidateId,
      subject_type: 'opportunity',
      subject_id: opportunityId,
      event: 'match_assessed',
      model_run_id: modelRunId,
      detail: {
        ...countVerdicts(analysis),
        // How much the model claimed that it could not point at. A number
        // worth watching: it is the difference between a reading and a story.
        downgradedForMissingCitations: countDowngrades(proposed, analysis),
        latencyMs,
      },
    })
  }

  const analysis: MatchAnalysis = {
    hardConstraints: JSON.parse(assessmentRow.hard_constraints),
    evidenceMatch: JSON.parse(assessmentRow.evidence_match),
    intentMatch: JSON.parse(assessmentRow.intent_match),
    unknowns: JSON.parse(assessmentRow.unknowns),
  }

  // ── Stage 3: the decision, proposed and then settled ───────────────────
  const existingDecision = getLatestDecision(opportunityId)
  if (existingDecision && existingDecision.assessment_id === assessmentRow.id) {
    return {
      opportunityId,
      decision: existingDecision.decision as Decision,
      modelDecision: (existingDecision.model_decision as Decision | null) ?? null,
      overrideReason: existingDecision.override_reason,
      unsupportedClaims: (JSON.parse(existingDecision.unsupported_claims) as unknown[]).length,
      ran,
    }
  }

  const proposal = await runners.decision({
    candidateId,
    input: {
      // La pregunta que salga de aquí se le manda tal cual, así que sale en
      // su idioma y no en el del prompt.
      language: readPreferences(candidateId).language,
      alreadyTold: context.alreadyTold,
      opportunity: { company: opportunity.company, role: opportunity.role },
      analysis,
    },
  })
  ran.push('decision')
  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'opportunity',
    subject_id: opportunityId,
    event: 'decision_proposed',
    model_run_id: proposal.modelRunId,
    detail: { decision: proposal.data.decision, latencyMs: proposal.latencyMs },
  })

  const settled: InterruptionDecision = settleDecision(analysis, {
    decision: proposal.data.decision,
    reason: stripInternalIds(proposal.data.reason),
    supportingEvidenceIds: proposal.data.supportingEvidenceIds.filter((id) =>
      context.side.evidenceIds.includes(id),
    ),
    supportingIntentRefs: proposal.data.supportingIntentReferences.filter((ref) =>
      context.side.intentReferences.some((item) => item.id === ref),
    ),
    materialUnknowns: proposal.data.materialUnknowns,
    nextBestAction: proposal.data.nextBestAction,
  })

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'opportunity',
    subject_id: opportunityId,
    event: 'decision_settled',
    detail: {
      modelDecision: settled.modelDecision,
      decision: settled.decision,
      overrideReason: settled.overrideReason,
      materialUnknowns: settled.materialUnknowns,
      nextBestAction: settled.nextBestAction,
    },
  })

  // ── Stage 4: only an interruption is explained ─────────────────────────
  let explanation: Explanation | null = null
  let unsupported: UnsupportedClaim[] = []
  let explanationRunId: string | null = null

  if (settled.decision === 'INTERRUPT') {
    const written = await runners.explanation({
      candidateId,
      input: {
        // La explicación es lo único que lee entera, así que la escribe en
        // su idioma. El resto de prompts no producen texto que nadie lea.
        language: readPreferences(candidateId).language,
        opportunity: { company: opportunity.company, role: opportunity.role },
        rubric,
        analysis,
        decision: { decision: settled.decision, reason: settled.reason },
        evidence: context.evidence,
        intentReferences: context.side.intentReferences,
      },
    })
    ran.push('explanation')
    explanationRunId = written.modelRunId

    const audited = auditExplanation(
      cleanExplanation(written.data),
      context.side,
      analysis.unknowns.map((item) => item.id),
    )
    explanation = audited.explanation
    unsupported = audited.unsupported

    recordAuditEvent({
      candidate_id: candidateId,
      subject_type: 'opportunity',
      subject_id: opportunityId,
      event: 'explanation_written',
      model_run_id: written.modelRunId,
      detail: {
        whyYou: explanation.whyYou.length,
        whatToConsider: explanation.whatToConsider.length,
        unsupportedClaims: unsupported.length,
        latencyMs: written.latencyMs,
      },
    })
  }

  const decisionRow = insertDecision({
    opportunity_id: opportunityId,
    assessment_id: assessmentRow.id,
    version: settled.decision === 'INTERRUPT' ? EXPLANATION_VERSION : DECISION_VERSION,
    model_decision: settled.modelDecision,
    decision: settled.decision,
    override_reason: settled.overrideReason,
    reason: settled.reason,
    supporting_evidence_ids: JSON.stringify(settled.supportingEvidenceIds),
    supporting_intent_refs: JSON.stringify(settled.supportingIntentRefs),
    material_unknowns: JSON.stringify(settled.materialUnknowns),
    next_action_type: settled.nextBestAction.type,
    next_action_question: settled.nextBestAction.question,
    explanation: explanation ? JSON.stringify(explanation) : null,
    unsupported_claims: JSON.stringify(unsupported),
    model_run_id: proposal.modelRunId,
    explanation_model_run_id: explanationRunId,
    latency_ms: proposal.latencyMs,
  })

  updateOpportunityStatus(opportunityId, 'decided')
  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'opportunity',
    subject_id: opportunityId,
    event: 'decision_recorded',
    detail: { decisionId: decisionRow.id, decision: settled.decision },
  })

  // Only an interruption is sent anywhere. A hold that quietly emailed
  // somebody would be the digest this product exists not to be.
  if (settled.decision === 'INTERRUPT') {
    const { queueInterruptionNotice } = await import('./notify')
    queueInterruptionNotice(candidateId, opportunityId)
  }

  // A hold waiting on them is the one kind of hold that can move tonight.
  if (settled.decision === 'HOLD' && settled.nextBestAction.type === 'ASK_CANDIDATE') {
    const { askCandidate } = await import('./opportunity-questions')
    const asked = askCandidate({
      candidateId,
      opportunityId,
      decisionId: decisionRow.id,
      analysis,
      action: settled.nextBestAction,
    })
    if (asked?.created) {
      // No sale ya: se deja reposar unos minutos para que las preguntas de
      // las demás ofertas de esta tanda salgan con ella, en un solo mensaje.
      // Cuatro avisos en diez minutos son cuatro razones para dejar de mirar
      // el móvil, y eso lo dijo él con esas palabras.
      const { enqueue, hasQueuedKind } = await import('./jobs')
      if (!hasQueuedKind(candidateId, 'send_questions')) {
        enqueue('send_questions', candidateId, {}, getQuestionBatchMs())
      }
    }
  }

  return {
    opportunityId,
    decision: settled.decision,
    modelDecision: settled.modelDecision,
    overrideReason: settled.overrideReason,
    unsupportedClaims: unsupported.length,
    ran,
  }
}

/** Nothing the candidate reads should contain our filing system. */
function cleanExplanation(explanation: Explanation): Explanation {
  return {
    headline: stripInternalIds(explanation.headline),
    whyShowing: {
      text: stripInternalIds(explanation.whyShowing.text),
      intentRefs: explanation.whyShowing.intentRefs,
    },
    whyYou: explanation.whyYou.map((claim) => ({
      text: stripInternalIds(claim.text),
      evidenceIds: claim.evidenceIds,
    })),
    whatToConsider: explanation.whatToConsider.map((item) => ({
      text: stripInternalIds(item.text),
      unknownIds: item.unknownIds,
    })),
  }
}

function unknownAttributesOf(rubric: OpportunityRubric): string[] {
  const missing: string[] = []
  if (!rubric.compensation || (rubric.compensation.min === null && rubric.compensation.max === null))
    missing.push('compensation')
  if (!rubric.equity) missing.push('equity')
  if (!rubric.workModel) missing.push('workModel')
  if (!rubric.location) missing.push('location')
  if (!rubric.companyStage) missing.push('companyStage')
  if (!rubric.seniority) missing.push('seniority')
  return missing
}

function countVerdicts(analysis: MatchAnalysis) {
  const tally = <T extends { verdict: string }>(items: T[]) =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.verdict] = (acc[item.verdict] ?? 0) + 1
      return acc
    }, {})
  return {
    hardConstraints: tally(analysis.hardConstraints),
    evidenceMatch: tally(analysis.evidenceMatch),
    intentMatch: tally(analysis.intentMatch),
    unknowns: analysis.unknowns.length,
  }
}

/**
 * How many verdicts validation had to walk back because the model claimed
 * something it could not point at. Matched by id, not by position:
 * validation drops entries whose requirement is not in the rubric, so the
 * two lists do not line up.
 */
function countDowngrades(
  proposed: {
    evidenceMatch: { requirementId: string; verdict: string }[]
    intentMatch: { id: string; verdict: string }[]
  },
  analysis: MatchAnalysis,
): number {
  const evidenceAfter = new Map(
    analysis.evidenceMatch.map((item) => [item.requirementId, item.verdict]),
  )
  const intentAfter = new Map(analysis.intentMatch.map((item) => [item.id, item.verdict]))

  let downgrades = 0
  for (const item of proposed.evidenceMatch) {
    const after = evidenceAfter.get(item.requirementId)
    if (after !== undefined && after !== item.verdict) downgrades++
  }
  for (const item of proposed.intentMatch) {
    const after = intentAfter.get(item.id)
    if (after !== undefined && after !== item.verdict) downgrades++
  }
  return downgrades
}

// ─── What the model is shown, for the lab and for the test ───────────────

/**
 * Every prompt this pipeline would send for an opportunity, as text.
 *
 * It exists so the promise that the blind human label never reaches the
 * model can be checked instead of asserted: the test builds these for an
 * opportunity whose label carries a distinctive token, and looks for the
 * token. The lab shows their sizes.
 */
export function stagePromptsFor(opportunityId: string): Record<string, Prompt> | null {
  const opportunity = getOpportunity(opportunityId)
  if (!opportunity) return null
  const context = candidateContext(opportunity.candidate_id)
  const prompts: Record<string, Prompt> = {
    rubric: buildRubricPrompt({
      company: opportunity.company,
      role: opportunity.role,
      url: opportunity.url,
      rawText: opportunity.raw_text,
    }),
  }

  const rubricRow = getLatestRubric(opportunityId)
  if (!rubricRow) return prompts
  const rubric = JSON.parse(rubricRow.rubric) as OpportunityRubric

  prompts.match = buildMatchPrompt({
    opportunity: { company: opportunity.company, role: opportunity.role },
    rubric,
    capabilities: context.capabilities,
    evidence: context.evidence,
    openUncertainties: context.openUncertainties,
    intentReferences: context.side.intentReferences,
  })

  const assessmentRow = getLatestAssessment(opportunityId)
  if (!assessmentRow) return prompts
  const analysis: MatchAnalysis = {
    hardConstraints: JSON.parse(assessmentRow.hard_constraints),
    evidenceMatch: JSON.parse(assessmentRow.evidence_match),
    intentMatch: JSON.parse(assessmentRow.intent_match),
    unknowns: JSON.parse(assessmentRow.unknowns),
  }

  prompts.decision = buildDecisionPrompt({
    opportunity: { company: opportunity.company, role: opportunity.role },
    analysis,
  })

  const decisionRow = getLatestDecision(opportunityId)
  if (decisionRow?.decision === 'INTERRUPT') {
    prompts.explanation = buildExplanationPrompt({
      opportunity: { company: opportunity.company, role: opportunity.role },
      rubric,
      analysis,
      decision: { decision: 'INTERRUPT', reason: decisionRow.reason },
      evidence: context.evidence,
      intentReferences: context.side.intentReferences,
    })
  }

  return prompts
}

// ─── The candidate's answer ───────────────────────────────────────────────

/**
 * Record what they said and stop there.
 *
 * Turning one opportunity down is not a change of mind about the shape of
 * what they want, and inferring one from a single tap would quietly rewrite
 * the thing they were asked to confirm. Nothing in here touches the Intent
 * Profile or the preferences — see `intentChangesFromResponse`.
 */
export function recordCandidateResponse(
  opportunityId: string,
  response: CandidateResponse,
): { ok: true } | { ok: false; error: string } {
  const opportunity = getOpportunity(opportunityId)
  if (!opportunity) return { ok: false, error: 'That opportunity is not here.' }
  const decision = getLatestDecision(opportunityId)
  if (!decision || decision.decision !== 'INTERRUPT') {
    return { ok: false, error: 'There is nothing to answer here.' }
  }

  insertResponse({
    opportunity_id: opportunityId,
    decision_id: decision.id,
    response,
  })
  recordAuditEvent({
    candidate_id: opportunity.candidate_id,
    subject_type: 'opportunity',
    subject_id: opportunityId,
    event: 'candidate_responded',
    detail: { response, decisionId: decision.id, intentChanged: false },
  })

  return { ok: true }
}

/** Only ever read by the lab and the harness, never by a prompt builder. */
export function blindLabelFor(opportunityId: string) {
  return getLabel(opportunityId)
}
