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
import { lookingFor } from './intent'
import { serverText } from '../i18n/candidate'
import { getDb } from '../db/db'

const MIN_QUESTIONS_TARGET = 3
const MAX_QUESTIONS = 12
// Defence goes first (it must happen before any company sees the profile), but
// it must not swallow the whole interview. Each question covers several claims.
const MAX_DEFENCE_QUESTIONS = 4
// In the web setup: two questions, both ready before they are needed; the
// third step is what they are looking for (/me/intent). The rest of the
// interview continues later, on WhatsApp.
export const SETUP_QUESTIONS = 2
const SETUP_DEFENCE_QUESTIONS = 1

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

// Work for one person runs one piece at a time, on two lines: planning
// questions, and taking answers in. On globalThis: pages and background work
// are separate bundles in one process.
declare global {
  var __ambleInterviewQueues: Map<string, Promise<unknown>> | undefined
}
const queues = (globalThis.__ambleInterviewQueues ??= new Map())

function inLine<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(work)
  queues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

function asTurn(turn: InterviewTurnRow): NextQuestion {
  return { action: 'ASK', kind: turnKind(turn), turnId: turn.id, question: turn.question ?? undefined, reason: turn.question_reason ?? undefined }
}

// The next question to show: the first one asked and not answered, in order;
// in the setup, a new one only while fewer than SETUP_QUESTIONS exist.
export function planNextQuestion(candidateId: string, options: { setup?: boolean } = {}): Promise<NextQuestion> {
  const setup = options.setup ?? true
  return inLine(`plan:${candidateId}`, async () => {
    const interview = getOrCreateInterview(candidateId)
    const turns = listTurns(interview.id)
    const pending = turns.find((turn) => turn.answer === null && turn.question !== null)
    if (pending) return asTurn(pending)
    if (setup && turns.length >= SETUP_QUESTIONS) {
      completeInterview(interview.id)
      return { action: 'STOP', reason: serverText().interviewLongEnough }
    }
    return planOne(candidateId, setup)
  })
}

// Right after their sources are read: both setup questions planned, the
// second aware of the first, so neither waits when its moment comes.
export function prepareSetupQuestions(candidateId: string): Promise<void> {
  return inLine(`plan:${candidateId}`, async () => {
    const interview = getOrCreateInterview(candidateId)
    while (listTurns(interview.id).length < SETUP_QUESTIONS) {
      const planned = await planOne(candidateId, true)
      if (planned.action === 'STOP') break
    }
  })
}

async function planOne(candidateId: string, setup: boolean): Promise<NextQuestion> {
  const interview = getOrCreateInterview(candidateId)
  const turns = listTurns(interview.id)
  const answered = turns.filter((turn) => turn.answer !== null)

  if (answered.length >= MAX_QUESTIONS) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: serverText().interviewLongEnough }
  }

  const defenceAsked = turns.filter((turn) => turn.kind === 'defence').length
  if (defenceAsked < (setup ? SETUP_DEFENCE_QUESTIONS : MAX_DEFENCE_QUESTIONS)) {
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
      return asTurn(turn)
    }
  }

  // A question planned before the answer to the one still waiting can only
  // avoid overlapping it by being about something else: the capabilities
  // those waiting questions ask about are left out.
  const taken = new Set(turns.filter((turn) => turn.answer === null).flatMap((turn) => parseJsonArray(turn.target_capability_ids)))
  const all = listCapabilities(candidateId)
  const everyTaken = all.every((capability) => taken.has(capability.id))
  const capabilities = everyTaken ? all : all.filter((capability) => !taken.has(capability.id))
  // Attribution uncertainty is settled by defence, never by a gap question: a
  // second account of the same work may have the same co-author.
  const open = listUncertainties(candidateId, 'OPEN').filter(
    (uncertainty) => uncertainty.kind !== 'ATTRIBUTION' && (uncertainty.capability_id === null || !taken.has(uncertainty.capability_id) || everyTaken),
  )
  const resolved = listUncertainties(candidateId, 'RESOLVED')

  const capabilityInput = capabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    assessment: capability.assessment,
    reason: capability.reason.slice(0, 200),
    uncertaintyIds: open.filter((uncertainty) => uncertainty.capability_id === capability.id).map((uncertainty) => uncertainty.id),
  }))

  const uncertaintyInput = open.map((uncertainty) => ({
    id: uncertainty.id,
    capabilityId: uncertainty.capability_id,
    description: uncertainty.description,
    materiality: uncertainty.materiality,
  }))

  // Every question already asked, answered or not: one still waiting for its
  // answer is a topic taken, never to be asked again.
  const recentTurns = turns.slice(-6).map((turn) => ({
    question: turn.question ?? '',
    answer: turn.answer === null ? '(asked, not answered yet: do not ask about this again)' : turn.answer.slice(0, 2000),
  }))
  const target = setup ? SETUP_QUESTIONS : MIN_QUESTIONS_TARGET
  const plan = () =>
    runPlanNextQuestionTask({
      candidateId,
      capabilities: capabilityInput,
      uncertainties: uncertaintyInput,
      resolvedUncertaintyIds: resolved.map((uncertainty) => uncertainty.id),
      recentTurns,
      questionsAsked: turns.length,
      minimumTarget: target,
      lookingFor: lookingFor(candidateId),
    })

  let result = await plan()
  if (result.data.action === 'STOP' && turns.length < target && open.length > 0) result = await plan()

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
  return asTurn(turn)
}

// The first question waiting for its answer, if one is already planned: shown
// at once, even while the next one is still being planned.
export function pendingQuestion(candidateId: string): NextQuestion | null {
  const pending = listTurns(getOrCreateInterview(candidateId).id).find((turn) => turn.answer === null && turn.question !== null)
  return pending ? asTurn(pending) : null
}

// The first read judges offers against the profile as it is when it runs.
// An answer that moves a capability changes the profile's fingerprint, and
// every verdict made before it is no longer shown: started while the setup
// questions wait, the first read would be spent on offers they never see.
// So it starts once the answers are in; after this long without them, it
// starts anyway.
export const FIRST_READ_WAITS_MS = 10 * 60 * 1000

export function hasUnansweredQuestion(candidateId: string): boolean {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM interview_turns t JOIN interviews i ON i.id = t.interview_id
         WHERE i.candidate_id = ? AND t.question IS NOT NULL AND t.answer IS NULL LIMIT 1`,
      )
      .get(candidateId),
  )
}

export function startFirstReadSoon(candidateId: string): void {
  void import('../matching/run').then(({ startFirstRead }) => startFirstRead(candidateId)).catch(() => undefined)
}

declare global {
  var __ambleAnswersInLine: Map<string, number> | undefined
}
// Answers kept but not yet taken into the profile, per person.
const answersInLine = (globalThis.__ambleAnswersInLine ??= new Map())

// An answer is theirs the moment they send it: kept at once, and taken into
// the profile afterwards, in line, once more if the model fails the first
// time. It is never handed back to them to send again.
export function takeAnswer(
  candidateId: string,
  turnId: string,
  answerText: string,
  then?: (result: IncorporatedAnswer) => Promise<void>,
): void {
  const turn = getTurn(turnId)
  if (!turn) throw new Error(serverText().turnNotFound)
  if (turn.answer !== null) return
  answerTurn(turnId, answerText)
  answersInLine.set(candidateId, (answersInLine.get(candidateId) ?? 0) + 1)
  void inLine(`answers:${candidateId}`, async () => {
    try {
      await incorporateInLine(candidateId, turn, turnId, answerText, then)
    } finally {
      const left = (answersInLine.get(candidateId) ?? 1) - 1
      if (left > 0) answersInLine.set(candidateId, left)
      else answersInLine.delete(candidateId)
      // Every question answered and taken in: the first read, if it has not run.
      if (left <= 0 && !hasUnansweredQuestion(candidateId)) startFirstReadSoon(candidateId)
    }
  })
}

async function incorporateInLine(
  candidateId: string,
  turn: InterviewTurnRow,
  turnId: string,
  answerText: string,
  then?: (result: IncorporatedAnswer) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await incorporateAnswerInner(candidateId, turn, answerText)
      // After, and outside the line: the next answer need not wait for it.
      if (then) void then(result).catch(() => undefined)
      return
    } catch (error) {
      // What the failed attempt wrote goes, the answer stays.
      undoTurnAnswer(turnId)
      answerTurn(turnId, answerText)
      if (attempt === 2) console.error('[interview] answer kept but not taken in:', turnId, error instanceof Error ? error.message : error)
    }
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
  const links = listCapabilityEvidenceIds(candidateId)
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
      evidenceIds: links.get(capability.id) ?? [],
    }))

  // Attribution uncertainty is domain state (syncAttributionUncertainties), not a
  // judgment the reassessment model may close.
  // Only those about the capabilities in scope (and general ones): the model
  // is asked for a status for each, and dozens of them overflow its answer.
  const openUncertainties = listUncertainties(candidateId, 'OPEN').filter(
    (uncertainty) => uncertainty.kind !== 'ATTRIBUTION' && (uncertainty.capability_id === null || scope.includes(uncertainty.capability_id)),
  )

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
