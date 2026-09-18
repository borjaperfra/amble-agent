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
  markInterviewStopping,
  newId,
  parseJsonArray,
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
import { enqueue, hasPendingKind } from './jobs'
import { isDuplicateUncertainty, similarity } from './uncertainty'
import { newEvidenceFromClaim } from './graph'

/** Ask enough to be useful, then get out of the way. */
const MIN_QUESTIONS_TARGET = 3
const MAX_QUESTIONS = 6

/** How many questions to keep planned ahead of the candidate. */
const QUESTION_BUFFER = 1

/** Past this, a capability is being interrogated rather than understood. */
const MAX_OPEN_UNCERTAINTIES_PER_CAPABILITY = 2

// ─── Convergence helpers ──────────────────────────────────────────────────

const DECLINE_PATTERNS = [
  /don'?t ask/i,
  /stop asking/i,
  /no more (of )?(this|that)/i,
  /already (told|answered|said)/i,
  /asked me (this|that) (again|already)/i,
  /(don'?t|do not|can'?t|cannot) remember/i,
  /no (lo )?recuerdo/i,
  /ya (te )?(lo )?(he )?(dicho|contestado|respondido)/i,
  /no (me )?preguntes m[áa]s/i,
  /siguiente pregunta/i,
  /next question/i,
]

function readsAsDeclined(answer: string): boolean {
  return DECLINE_PATTERNS.some((pattern) => pattern.test(answer))
}

// ─── Question queue ───────────────────────────────────────────────────────

export interface NextQuestion {
  /** WAIT: nothing to show yet, the queue is working on it. Ask again. */
  action: 'ASK' | 'STOP' | 'WAIT'
  turnId?: string
  question?: string
  reason?: string
}

function unanswered(interviewId: string): InterviewTurnRow[] {
  return listTurns(interviewId).filter((turn) => turn.answer === null && turn.question !== null)
}

function answeredCount(interviewId: string): number {
  return listTurns(interviewId).filter((turn) => turn.answer !== null).length
}

function asQuestion(turn: InterviewTurnRow): NextQuestion {
  return {
    action: 'ASK',
    turnId: turn.id,
    question: turn.question ?? undefined,
    reason: turn.question_reason ?? undefined,
  }
}

/**
 * The question the candidate should see now, without ever waiting on the
 * model inside the request.
 *
 * A planned question comes back instantly, which is the point of the buffer.
 * When there is none, the work goes on the queue and the answer is WAIT: the
 * phone asks again in a couple of seconds rather than holding a connection
 * open for a minute and a half, which is a connection a phone will drop.
 */
export function getQuestionWithoutWaiting(candidateId: string): NextQuestion {
  const interview = getOrCreateInterview(candidateId)
  const queued = unanswered(interview.id)
  if (queued.length > 0) return asQuestion(queued[0])

  if (interview.status === 'stopping' || answeredCount(interview.id) >= MAX_QUESTIONS) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: 'I have what I need for now.' }
  }

  // Queues one if nothing is in flight, and is happy to be called again.
  prefetchQuestion(candidateId)
  return { action: 'WAIT', reason: 'Working out what to ask next.' }
}

/**
 * The blocking version: plan here and now, and make the caller wait for it.
 * Kept for anything that has no way to come back and ask again.
 */
export async function getCurrentQuestion(candidateId: string): Promise<NextQuestion> {
  const interview = getOrCreateInterview(candidateId)
  const queued = unanswered(interview.id)
  if (queued.length > 0) return asQuestion(queued[0])

  if (interview.status === 'stopping' || answeredCount(interview.id) >= MAX_QUESTIONS) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: 'I have what I need for now.' }
  }

  // Nothing planned ahead — plan one now and make the candidate wait for it.
  const planned = await planOneQuestion(candidateId)
  if (!planned) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: 'I have what I need for now.' }
  }
  return asQuestion(planned)
}

/** Top up the buffer without blocking anyone. Safe to call repeatedly. */
export function prefetchQuestion(candidateId: string): void {
  if (hasPendingKind(candidateId, 'plan_question')) return
  const interview = getOrCreateInterview(candidateId)
  if (interview.status !== 'active') return
  if (unanswered(interview.id).length > QUESTION_BUFFER) return
  if (answeredCount(interview.id) + unanswered(interview.id).length >= MAX_QUESTIONS) return

  enqueue('plan_question', candidateId)
}

/** The queue's side of prefetchQuestion. */
export async function planQuestionJob(candidateId: string): Promise<void> {
  await planOneQuestion(candidateId)
}

/**
 * The queue's side of recordAnswer. Takes an id rather than the turn itself:
 * the job may be picked up minutes later, by a different process, after a
 * connection came back.
 */
export async function incorporateAnswerJob(candidateId: string, turnId: string): Promise<void> {
  const turn = getTurn(turnId)
  if (!turn) throw new Error(`Interview turn ${turnId} is gone.`)
  if (turn.answer === null) throw new Error(`Interview turn ${turnId} has no answer to work from.`)
  await incorporateAnswer(candidateId, turn, turn.answer)
}

/**
 * Plan exactly one question and store it. Returns null when the planner
 * decides there is nothing left worth asking.
 */
async function planOneQuestion(candidateId: string): Promise<InterviewTurnRow | null> {
  const interview = getOrCreateInterview(candidateId)
  const turns = listTurns(interview.id)
  const answered = turns.filter((turn) => turn.answer !== null)
  // A question planned ahead is still a question the candidate is about to
  // see. Planning on top of one means planning against ground already taken.
  const pending = turns.filter((turn) => turn.answer === null)
  const buffering = pending.length > 0

  // When there is already a question waiting, finding nothing new to ask is
  // not a reason to end the interview — that one still has to be answered.
  const giveUp = (): null => {
    if (!buffering) markInterviewStopping(interview.id)
    return null
  }

  if (answered.length >= MAX_QUESTIONS) {
    markInterviewStopping(interview.id)
    return null
  }

  const capabilities = listCapabilities(candidateId)
  const open = listUncertainties(candidateId, 'OPEN')
  const resolved = listUncertainties(candidateId, 'RESOLVED')
  const accepted = listUncertainties(candidateId, 'ACCEPTED_UNKNOWN')

  // Never re-open a subject the candidate has already closed.
  const closedCapabilities = new Set(
    accepted.map((item) => item.capability_id).filter((id): id is string => Boolean(id)),
  )
  // Whatever the waiting question already goes after is spoken for.
  const spokenFor = new Set(
    pending.flatMap((turn) => parseJsonArray(turn.target_uncertainty_ids)),
  )
  const askable = open.filter(
    (item) =>
      item.resolvable_by_interview === 1 &&
      !closedCapabilities.has(item.capability_id ?? '') &&
      !spokenFor.has(item.id),
  )

  if (askable.length === 0 && (buffering || answered.length >= MIN_QUESTIONS_TARGET)) {
    return giveUp()
  }

  // Highest materiality first, and only a handful: handing the planner 42 open
  // threads is what made it circle the same ground.
  const ranked = [...askable].sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>
    return (order[a.materiality] ?? 3) - (order[b.materiality] ?? 3)
  })
  const shortlist = ranked.slice(0, 12)
  const shortlistIds = new Set(shortlist.map((item) => item.id))

  const capabilityInput = capabilities
    .filter((capability) => shortlist.some((item) => item.capability_id === capability.id))
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      assessment: capability.assessment,
      reason: capability.reason.slice(0, 200),
      uncertaintyIds: shortlist
        .filter((item) => item.capability_id === capability.id)
        .map((item) => item.id),
    }))

  // Everything the candidate has seen or is about to see, so the planner does
  // not re-ask the question sitting in the buffer.
  const askedQuestions = [...answered, ...pending].map((turn) => turn.question ?? '').filter(Boolean)

  const result = await runPlanNextQuestionTask({
    candidateId,
    capabilities: capabilityInput,
    uncertainties: shortlist.map((item) => ({
      id: item.id,
      capabilityId: item.capability_id,
      description: item.description,
      materiality: item.materiality,
    })),
    resolvedUncertaintyIds: [...resolved, ...accepted].map((item) => item.id),
    recentTurns: answered.slice(-5).map((turn) => ({
      question: turn.question ?? '',
      answer: (turn.answer ?? '').slice(0, 1200),
    })),
    questionsAsked: answered.length,
    minimumTarget: MIN_QUESTIONS_TARGET,
    alreadyAsked: askedQuestions,
    questionsRemaining: MAX_QUESTIONS - answered.length - pending.length,
  })

  if (result.data.action === 'STOP' || !result.data.question) {
    return giveUp()
  }

  // Last line of defence: if the planner produced a near-copy of something
  // already asked or already queued, drop it rather than ask twice.
  if (askedQuestions.some((asked) => similarity(asked, result.data.question as string) >= 0.65)) {
    return giveUp()
  }

  return insertTurn({
    id: newId('turn'),
    interview_id: interview.id,
    idx: turns.length,
    question: result.data.question,
    question_reason: result.data.reason,
    target_capability_ids: JSON.stringify(result.data.targetCapabilityIds),
    target_uncertainty_ids: JSON.stringify(
      result.data.targetUncertaintyIds.filter((id) => shortlistIds.has(id)),
    ),
  })
}

// ─── Answers ──────────────────────────────────────────────────────────────

export interface AnswerAccepted {
  ok: true
  /** The next question, when one was already waiting. */
  next: NextQuestion | null
}

/**
 * Store the answer and hand back the next question immediately. Everything
 * the answer implies for the graph happens on the queue afterwards.
 */
export function recordAnswer(candidateId: string, turnId: string, answerText: string): AnswerAccepted {
  const turn = getTurn(turnId)
  if (!turn) throw new Error('Interview turn not found.')

  if (turn.answer !== null) {
    // A phone that lost signal mid-send sends it again when it comes back.
    // The same answer arriving twice is the network stuttering, not a second
    // answer, so hand back what the first one earned rather than an error.
    if (turn.answer.trim() !== answerText.trim()) {
      throw new Error('This question has already been answered.')
    }
    return { ok: true, next: whatIsWaiting(candidateId) }
  }

  answerTurn(turnId, answerText)

  if (readsAsDeclined(answerText)) closeSubject(candidateId, turn)

  // Order matters. Queueing the graph work first starts it draining
  // immediately, and the question the candidate is actually waiting for ends
  // up behind a 20s job even though it jumps the line — the line is only
  // consulted once the current job is done.
  prefetchQuestion(candidateId)
  enqueue('incorporate_answer', candidateId, { turnId })

  return { ok: true, next: whatIsWaiting(candidateId) }
}

/** The question already planned ahead, if there is one. */
function whatIsWaiting(candidateId: string): NextQuestion | null {
  const interview = getOrCreateInterview(candidateId)
  const queued = unanswered(interview.id)
  return queued.length > 0 ? asQuestion(queued[0]) : null
}

/**
 * The candidate said they do not want to go further down this road. Accept it
 * for the whole subject, not just the one thread that was asked about.
 */
function closeSubject(candidateId: string, turn: InterviewTurnRow): void {
  const targets = parseJsonArray(turn.target_uncertainty_ids)
  const capabilities = parseJsonArray(turn.target_capability_ids)
  const open = listUncertainties(candidateId, 'OPEN')

  for (const uncertainty of open) {
    const targeted = targets.includes(uncertainty.id)
    const sameCapability =
      uncertainty.capability_id !== null && capabilities.includes(uncertainty.capability_id)
    if (targeted || sameCapability) {
      updateUncertaintyStatus(uncertainty.id, 'ACCEPTED_UNKNOWN', turn.id, 'The candidate chose not to go further here.')
    }
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

  // Only the uncertainties this answer could plausibly move. Sending all 56 is
  // what pushed this task to 31s average and 116s at worst.
  const openUncertainties = listUncertainties(candidateId, 'OPEN').filter(
    (uncertainty) => uncertainty.capability_id === null || scope.includes(uncertainty.capability_id),
  )

  const resolvedUncertaintyIds: string[] = []
  const reassessedCapabilityIds: string[] = []

  if (allScopeEvidence.length === 0) {
    return { claimsCreated, evidenceCreated: evidenceIds.length, resolvedUncertaintyIds, reassessedCapabilityIds }
  }

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

  addNewUncertainties(candidateId, turn, reassessData.newUncertainties)

  return { claimsCreated, evidenceCreated: evidenceIds.length, resolvedUncertaintyIds, reassessedCapabilityIds }
}

/**
 * New questions discovered from an answer, admitted only while there is still
 * interview left to ask them in. Previously every answer opened more threads
 * than it closed — 56 created, 42 still open at the end — so the interview
 * could never converge.
 */
function addNewUncertainties(
  candidateId: string,
  turn: InterviewTurnRow,
  incoming: { capabilitySlug?: string | null; description: string; materiality: string }[],
): void {
  const interview = getOrCreateInterview(candidateId)
  const answered = answeredCount(interview.id)

  // Past the halfway mark, opening new ground just delays the reward.
  if (answered >= Math.floor(MAX_QUESTIONS / 2)) return

  for (const candidate of incoming) {
    if (candidate.materiality !== 'HIGH') continue

    const capabilityId = candidate.capabilitySlug ?? null
    const open = listUncertainties(candidateId, 'OPEN')

    if (isDuplicateUncertainty(open, candidate.description, capabilityId)) continue

    const openForCapability = open.filter((item) => item.capability_id === capabilityId).length
    if (openForCapability >= MAX_OPEN_UNCERTAINTIES_PER_CAPABILITY) continue

    insertUncertainty({
      id: newId('unc'),
      candidate_id: candidateId,
      capability_id: capabilityId,
      description: candidate.description,
      reason: `Discovered from interview turn ${turn.idx + 1}`,
      materiality: candidate.materiality,
      status: 'OPEN',
      resolvable_by_interview: 1,
    })
  }
}

// ─── Progress ─────────────────────────────────────────────────────────────

export interface InterviewProgress {
  asked: number
  /** Best current estimate of the total, never presented as a hard promise. */
  expected: number
  remaining: number
  complete: boolean
}

export function interviewProgress(candidateId: string): InterviewProgress {
  const interview = getOrCreateInterview(candidateId)
  const turns = listTurns(interview.id)
  const asked = turns.filter((turn) => turn.answer !== null).length
  const stopping = interview.status !== 'active'

  const askable = listUncertainties(candidateId, 'OPEN').filter(
    (item) => item.resolvable_by_interview === 1,
  ).length

  const expected = stopping
    ? asked
    : Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS_TARGET, asked + Math.min(askable, 2)))

  return {
    asked,
    expected,
    remaining: Math.max(0, expected - asked),
    complete: interview.status === 'completed',
  }
}

export function getInterviewState(candidateId: string): { interviewId: string; turns: InterviewTurnRow[] } {
  const interview = getOrCreateInterview(candidateId)
  return { interviewId: interview.id, turns: listTurns(interview.id) }
}
