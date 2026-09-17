import {
  answerTurn,
  completeInterview,
  getOrCreateInterview,
  getTurn,
  insertClaim,
  insertTurn,
  insertUncertainty,
  listCapabilities,
  listCapabilityEvidenceIds,
  listEvidence,
  listEvidenceForCapabilities,
  listTurns,
  listUncertainties,
  newId,
  parseJsonArray,
  uncertaintyExistsByDescription,
  updateUncertaintyStatus,
  upsertCapability,
  linkCapabilityEvidence,
  type InterviewTurnRow,
} from '../db/repo'
import { getDb } from '../db/db'
import {
  runExtractAnswerClaimsTask,
  runPlanNextQuestionTask,
  runReassessAfterAnswerTask,
} from '../model/tasks'
import { newEvidenceFromClaim } from './graph'

const MIN_QUESTIONS_TARGET = 3
const MAX_QUESTIONS = 12

export interface NextQuestion {
  action: 'ASK' | 'STOP'
  turnId?: string
  question?: string
  reason?: string
}

export async function planNextQuestion(candidateId: string): Promise<NextQuestion> {
  const interview = getOrCreateInterview(candidateId)
  const turns = listTurns(interview.id)
  const answered = turns.filter((turn) => turn.answer !== null)

  if (answered.length >= MAX_QUESTIONS) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: 'The interview has reached its useful length for this build.' }
  }

  const capabilities = listCapabilities(candidateId)
  const open = listUncertainties(candidateId, 'OPEN')
  const resolved = listUncertainties(candidateId, 'RESOLVED')

  const capabilityInput = capabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    assessment: capability.assessment,
    reason: capability.reason.slice(0, 200),
    uncertaintyIds: open
      .filter((uncertainty) => uncertainty.capability_id === capability.id)
      .map((uncertainty) => uncertainty.id),
  }))

  const uncertaintyInput = open.map((uncertainty) => ({
    id: uncertainty.id,
    capabilityId: uncertainty.capability_id,
    description: uncertainty.description,
    materiality: uncertainty.materiality,
  }))

  const recentTurns = answered.slice(-5).map((turn) => ({
    question: turn.question ?? '',
    answer: (turn.answer ?? '').slice(0, 2000),
  }))

  let result = await runPlanNextQuestionTask({
    candidateId,
    capabilities: capabilityInput,
    uncertainties: uncertaintyInput,
    resolvedUncertaintyIds: resolved.map((uncertainty) => uncertainty.id),
    recentTurns,
    questionsAsked: answered.length,
    minimumTarget: MIN_QUESTIONS_TARGET,
  })

  if (
    result.data.action === 'STOP' &&
    answered.length < MIN_QUESTIONS_TARGET &&
    open.length > 0
  ) {
    result = await runPlanNextQuestionTask({
      candidateId,
      capabilities: capabilityInput,
      uncertainties: uncertaintyInput,
      resolvedUncertaintyIds: resolved.map((uncertainty) => uncertainty.id),
      recentTurns,
      questionsAsked: answered.length,
      minimumTarget: MIN_QUESTIONS_TARGET,
    })
  }

  if (result.data.action === 'STOP') {
    completeInterview(interview.id)
    return { action: 'STOP', reason: result.data.reason }
  }

  const turn = insertTurn({
    id: newId('turn'),
    interview_id: interview.id,
    idx: turns.length,
    question: result.data.question ?? null,
    question_reason: result.data.reason,
    target_capability_ids: JSON.stringify(result.data.targetCapabilityIds),
    target_uncertainty_ids: JSON.stringify(result.data.targetUncertaintyIds),
  })

  return {
    action: 'ASK',
    turnId: turn.id,
    question: result.data.question ?? undefined,
    reason: result.data.reason,
  }
}

export interface IncorporatedAnswer {
  claimsCreated: number
  evidenceCreated: number
  resolvedUncertaintyIds: string[]
  reassessedCapabilityIds: string[]
}

export async function incorporateAnswer(
  candidateId: string,
  turnId: string,
  answerText: string,
): Promise<IncorporatedAnswer> {
  const turn = getTurn(turnId)
  if (!turn) throw new Error('Interview turn not found.')
  if (turn.answer !== null) throw new Error('This question has already been answered.')

  const db = getDb()
  db.exec('BEGIN')
  try {
    answerTurn(turnId, answerText)
    const result = await incorporateAnswerInner(candidateId, turn, answerText)
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function incorporateAnswerInner(
  candidateId: string,
  turn: InterviewTurnRow,
  answerText: string,
): Promise<IncorporatedAnswer> {
  const turnId = turn.id

  const { data: answerData } = await runExtractAnswerClaimsTask({
    candidateId,
    question: turn.question ?? '',
    questionReason: turn.question_reason ?? '',
    answer: answerText,
  })

  let claimsCreated = 0
  const evidenceIds: string[] = []
  const suggestedSlugs = new Set<string>()

  for (const claim of answerData.claims) {
    const inserted = insertClaim({
      id: newId('clm'),
      candidate_id: candidateId,
      source_id: null,
      interview_turn_id: turnId,
      statement: claim.statement,
      claim_type: claim.claimType,
      epistemic_state: claim.epistemicState,
      source_excerpt: claim.sourceExcerpt,
      source_location: claim.sourceLocation ?? null,
      confidence: claim.confidence,
      requires_confirmation: claim.requiresConfirmation ? 1 : 0,
      possible_capabilities: JSON.stringify(claim.possibleCapabilities),
    })
    claimsCreated++
    const evidence = newEvidenceFromClaim(inserted, turnId, candidateId)
    evidenceIds.push(evidence.id)
    for (const slug of parseJsonArray(inserted.possible_capabilities)) suggestedSlugs.add(slug)
  }

  const targetCapabilityIds = parseJsonArray(turn.target_capability_ids)

  const capabilities = listCapabilities(candidateId)
  const scopedSlugs = [...suggestedSlugs, ...targetCapabilityIds].filter((slug) =>
    capabilities.some((capability) => capability.id === slug),
  )
  const scope = scopedSlugs.length > 0 ? scopedSlugs : capabilities.map((capability) => capability.id)
  const scopedEvidence = listEvidenceForCapabilities(candidateId, scope)
  const allScopeEvidence = [
    ...scopedEvidence,
    ...listEvidence(candidateId).filter((item) => evidenceIds.includes(item.id)),
  ]

  const affectedCapabilities = capabilities
    .filter((capability) => scope.includes(capability.id))
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      assessment: capability.assessment,
      reason: capability.reason.slice(0, 200),
      evidenceIds: listCapabilityEvidenceIds(candidateId).get(capability.id) ?? [],
    }))

  const openUncertainties = listUncertainties(candidateId, 'OPEN')

  const resolvedUncertaintyIds: string[] = []
  const reassessedCapabilityIds: string[] = []


  if (allScopeEvidence.length > 0) {
    const { data: reassessData } = await runReassessAfterAnswerTask({
      candidateId,
      affectedCapabilities,
      evidence: allScopeEvidence.map((item) => ({
        id: item.id,
        statement: item.statement,
        epistemicState: item.epistemic_state,
        sourceType: item.source_type,
        sourceExcerpt: item.source_excerpt ? item.source_excerpt.slice(0, 200) : null,
        candidateConfirmed: item.candidate_confirmed === 1,
      })),
      openUncertainties: openUncertainties.map((uncertainty) => ({
        id: uncertainty.id,
        capabilityId: uncertainty.capability_id,
        description: uncertainty.description,
        materiality: uncertainty.materiality,
      })),
      question: turn.question ?? '',
      answer: answerText,
    })

    const validEvidenceIds = new Set(allScopeEvidence.map((item) => item.id))
    for (const assessment of reassessData.assessments) {
      if (!affectedCapabilities.some((capability) => capability.id === assessment.slug)) continue
      const evidenceForCapability = assessment.evidenceIds.filter((id) => validEvidenceIds.has(id))
      if (evidenceForCapability.length === 0) continue
      upsertCapability(candidateId, assessment.slug, assessment.name, assessment.assessment, assessment.reason)
      linkCapabilityEvidence(candidateId, assessment.slug, evidenceForCapability)
      reassessedCapabilityIds.push(assessment.slug)
    }

    for (const update of reassessData.uncertaintyUpdates) {
      if (!openUncertainties.some((uncertainty) => uncertainty.id === update.id)) continue
      updateUncertaintyStatus(update.id, update.status, turnId, update.note ?? null)
      if (update.status === 'RESOLVED') resolvedUncertaintyIds.push(update.id)
    }

    for (const uncertainty of reassessData.newUncertainties) {
      if (uncertaintyExistsByDescription(candidateId, uncertainty.description)) continue
      insertUncertainty({
        id: newId('unc'),
        candidate_id: candidateId,
        capability_id: uncertainty.capabilitySlug ?? null,
        description: uncertainty.description,
        reason: `Discovered from interview turn ${turn.idx + 1}`,
        materiality: uncertainty.materiality,
        status: 'OPEN',
        resolvable_by_interview: uncertainty.materiality === 'LOW' ? 0 : 1,
      })
    }
  }

  return {
    claimsCreated,
    evidenceCreated: evidenceIds.length,
    resolvedUncertaintyIds,
    reassessedCapabilityIds,
  }
}

export function getInterviewState(candidateId: string): { interviewId: string; turns: InterviewTurnRow[] } {
  const interview = getOrCreateInterview(candidateId)
  return { interviewId: interview.id, turns: listTurns(interview.id) }
}
