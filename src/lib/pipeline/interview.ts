import {
  answerTurn,
  undoTurnAnswer,
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
import {
  runExtractAnswerClaimsTask,
  runPlanNextQuestionTask,
  runReassessAfterAnswerTask,
} from '../model/tasks'
import { newEvidenceFromClaim, reconcileCapabilities, syncAttributionUncertainties } from './graph'
import { judgeDefenceAnswer, planDefenceQuestion, type DefenceResult } from './defence'
import { serverText } from '../i18n/candidate'

const MIN_QUESTIONS_TARGET = 3
const MAX_QUESTIONS = 12
// Defence goes first (it must happen before any company sees the profile), but
// it must not swallow the whole interview. Each question covers several claims.
const MAX_DEFENCE_QUESTIONS = 4

export interface NextQuestion {
  action: 'ASK' | 'STOP'
  kind?: 'gap' | 'defence'
  turnId?: string
  question?: string
  reason?: string
}

function turnKind(turn: InterviewTurnRow): 'gap' | 'defence' {
  return turn.kind === 'defence' ? 'defence' : 'gap'
}

export async function planNextQuestion(candidateId: string): Promise<NextQuestion> {
  const interview = getOrCreateInterview(candidateId)
  const turns = listTurns(interview.id)
  const answered = turns.filter((turn) => turn.answer !== null)

  const pendingTurn = [...turns].reverse().find((turn) => turn.answer === null && turn.question !== null)
  if (pendingTurn) {
    return {
      action: 'ASK',
      kind: turnKind(pendingTurn),
      turnId: pendingTurn.id,
      question: pendingTurn.question ?? undefined,
      reason: pendingTurn.question_reason ?? undefined,
    }
  }

  if (answered.length >= MAX_QUESTIONS) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: serverText().interviewLongEnough }
  }

  const defenceAsked = turns.filter((turn) => turn.kind === 'defence').length
  if (defenceAsked < MAX_DEFENCE_QUESTIONS) {
    const defence = await planDefenceQuestion(candidateId)
    if (defence) {
      const turn = insertTurn({
        id: newId('turn'),
        interview_id: interview.id,
        idx: turns.length,
        question: defence.question,
        question_reason: defence.reason,
        target_capability_ids: JSON.stringify(defence.capabilityIds),
        target_uncertainty_ids: '[]',
        kind: 'defence',
        target_evidence_ids: JSON.stringify(defence.evidenceIds),
      })
      return { action: 'ASK', kind: 'defence', turnId: turn.id, question: defence.question, reason: defence.reason }
    }
  }

  const capabilities = listCapabilities(candidateId)
  // Attribution uncertainty is settled by defence, never by a gap question: a
  // second account of the same work may have the same co-author.
  const open = listUncertainties(candidateId, 'OPEN').filter((uncertainty) => uncertainty.kind !== 'ATTRIBUTION')
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
    kind: 'gap',
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
  defence?: Omit<DefenceResult, 'affectedCapabilityIds'>
  // A capability level moved: the distinctive profile and descriptor are stale.
  // The caller refreshes them (refreshDerivedProfile) after answering.
  profileNeedsRefresh: boolean
}

export async function incorporateAnswer(
  candidateId: string,
  turnId: string,
  answerText: string,
): Promise<IncorporatedAnswer> {
  const turn = getTurn(turnId)
  if (!turn) throw new Error(serverText().turnNotFound)
  if (turn.answer !== null) throw new Error(serverText().alreadyAnswered)

  // Marked answered first, so the same answer sent twice is taken in once.
  // If taking it in fails, it is undone whole and can be given again.
  answerTurn(turnId, answerText)
  try {
    return await incorporateAnswerInner(candidateId, turn, answerText)
  } catch (error) {
    undoTurnAnswer(turnId)
    throw error
  }
}

async function incorporateAnswerInner(
  candidateId: string,
  turn: InterviewTurnRow,
  answerText: string,
): Promise<IncorporatedAnswer> {
  const turnId = turn.id

  if (turnKind(turn) === 'defence') return incorporateDefenceAnswer(candidateId, turn, answerText)

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
  const { resolvedUncertaintyIds, reassessedCapabilityIds } = await reassessScope(
    candidateId,
    turn,
    answerText,
    scope,
    evidenceIds,
  )
  const reconciled = reconcileCapabilities(candidateId)
  syncAttributionUncertainties(candidateId, turnId)

  return {
    claimsCreated,
    evidenceCreated: evidenceIds.length,
    resolvedUncertaintyIds,
    reassessedCapabilityIds,
    profileNeedsRefresh: reassessedCapabilityIds.length > 0 || reconciled.length > 0,
  }
}

// A defence answer does not add evidence; it changes the standing of evidence
// that already exists. Promote, keep or retract, then reassess what rested on it.
async function incorporateDefenceAnswer(
  candidateId: string,
  turn: InterviewTurnRow,
  answerText: string,
): Promise<IncorporatedAnswer> {
  const { affectedCapabilityIds, ...defence } = await judgeDefenceAnswer(candidateId, turn, answerText)

  let resolvedUncertaintyIds: string[] = []
  let reassessedCapabilityIds: string[] = []
  const changed = defence.defended.length > 0 || defence.retracted.length > 0
  if (changed && affectedCapabilityIds.length > 0) {
    // The verdict is written by now, and a retraction is permanent: it stands
    // even if the reassessment fails. The deterministic ceiling below still
    // applies; only a level the model would have raised is missed.
    try {
      ;({ resolvedUncertaintyIds, reassessedCapabilityIds } = await reassessScope(
        candidateId,
        turn,
        answerText,
        affectedCapabilityIds,
        [],
      ))
    } catch {
      // Reassessment is best-effort once the defence is judged.
    }
  }

  // A promotion can lift a capability out of the assisted ceiling only through a
  // reassessment; a retraction must lower it even when the model skipped it.
  for (const id of reconcileCapabilities(candidateId)) {
    if (!reassessedCapabilityIds.includes(id)) reassessedCapabilityIds.push(id)
  }

  const before = new Set(listUncertainties(candidateId, 'RESOLVED').map((row) => row.id))
  syncAttributionUncertainties(candidateId, turn.id)
  for (const row of listUncertainties(candidateId, 'RESOLVED')) {
    if (!before.has(row.id)) resolvedUncertaintyIds.push(row.id)
  }

  return {
    claimsCreated: 0,
    evidenceCreated: 0,
    resolvedUncertaintyIds,
    reassessedCapabilityIds,
    defence,
    profileNeedsRefresh: reassessedCapabilityIds.length > 0,
  }
}

async function reassessScope(
  candidateId: string,
  turn: InterviewTurnRow,
  answerText: string,
  scope: string[],
  evidenceIds: string[],
): Promise<{ resolvedUncertaintyIds: string[]; reassessedCapabilityIds: string[] }> {
  const turnId = turn.id
  const capabilities = listCapabilities(candidateId)
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

  // Attribution uncertainty is domain state (syncAttributionUncertainties), not a
  // judgment the reassessment model may close.
  const openUncertainties = listUncertainties(candidateId, 'OPEN').filter((uncertainty) => uncertainty.kind !== 'ATTRIBUTION')

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
        reason: serverText().discoveredInTurn(turn.idx + 1),
        materiality: uncertainty.materiality,
        status: 'OPEN',
        resolvable_by_interview: uncertainty.materiality === 'LOW' ? 0 : 1,
      })
    }
  }

  return { resolvedUncertaintyIds, reassessedCapabilityIds }
}

export function getInterviewState(candidateId: string): { interviewId: string; turns: InterviewTurnRow[] } {
  const interview = getOrCreateInterview(candidateId)
  return { interviewId: interview.id, turns: listTurns(interview.id) }
}
