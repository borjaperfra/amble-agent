import {
  answerTurn,
  undoTurnAnswer,
  completeInterview,
  getOrCreateInterview,
  getEvidence,
  getTurn,
  getUncertainty,
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
  retractEvidence,
  setPlannedGaps,
  uncertaintyExistsByDescription,
  updateUncertaintyStatus,
  upsertCapability,
  linkCapabilityEvidence,
  type InterviewTurnRow,
  type UncertaintyRow,
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
const MAX_NEW_GAPS_PER_ANSWER = 1

export interface NextQuestion {
  action: 'ASK' | 'STOP'
  kind?: 'gap' | 'defence'
  turnId?: string
  question?: string
  reason?: string
  // A round past the setup ended: 'done' when its questions were asked,
  // 'empty' when the map showed nothing worth asking.
  round?: 'done' | 'empty'
}

function turnKind(turn: InterviewTurnRow): 'gap' | 'defence' {
  return turn.kind === 'defence' ? 'defence' : 'gap'
}

// What they told the Rep on WhatsApp without being asked (to add to their
// map or correct it): kept as a turn, so it is taken in exactly as an answer
// is, but never counted as a question asked.
const NOTE = 'note'

function asked(turns: InterviewTurnRow[]): InterviewTurnRow[] {
  return turns.filter((turn) => turn.kind !== NOTE)
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
  // Until their first interview is over, the setup's; after, a round.
  const setup = options.setup ?? !getDb().prepare("SELECT 1 FROM interviews WHERE candidate_id = ? AND status = 'completed'").get(candidateId)
  return inLine(`plan:${candidateId}`, async () => {
    const interview = getOrCreateInterview(candidateId)
    const turns = listTurns(interview.id)
    const pending = turns.find((turn) => turn.answer === null && turn.question !== null)
    if (pending) return asTurn(pending)
    if (setup && asked(turns).length >= SETUP_QUESTIONS) {
      completeInterview(interview.id)
      return { action: 'STOP', reason: serverText().interviewLongEnough }
    }
    return setup ? planOne(candidateId, true) : planRound(candidateId)
  })
}

// Past the setup, questions come in rounds (#22). A round asks what the map
// showed under what is still unknown when it began, one question each, in
// its order, and nothing else: before, every answer could bring other
// questions to the map and the next one was about anything, so it never
// ended and never matched what they had read. What their answers open
// waits for the next round; the round ends when its questions are asked.
// On the web and on WhatsApp alike.
async function planRound(candidateId: string): Promise<NextQuestion> {
  const interview = getOrCreateInterview(candidateId)
  const everyTurn = listTurns(interview.id)
  if (asked(everyTurn).filter((turn) => turn.answer !== null).length >= MAX_QUESTIONS) {
    completeInterview(interview.id)
    return { action: 'STOP', reason: serverText().interviewLongEnough, round: 'done' }
  }
  let planned: string[]
  if (interview.planned_gaps === null) {
    // Loaded here: the map's view reads much of what this file feeds.
    const { mapGapIds } = await import('../view')
    planned = mapGapIds(candidateId)
    setPlannedGaps(interview.id, planned)
  } else {
    planned = parseJsonArray(interview.planned_gaps)
  }
  const askedAbout = new Set(everyTurn.flatMap((turn) => parseJsonArray(turn.target_uncertainty_ids)))
  for (const id of [...planned]) {
    if (askedAbout.has(id)) continue
    const gap = getUncertainty(id)
    // Settled meanwhile (another answer, a document): nothing to ask.
    if (!gap || gap.candidate_id !== candidateId || gap.status !== 'OPEN') continue
    const turn = await roundTurn(candidateId, interview.id, everyTurn, gap)
    if (turn) return asTurn(turn)
    // Nothing worth asking about it after all: it leaves the round.
    planned = planned.filter((other) => other !== id)
    setPlannedGaps(interview.id, planned)
  }
  completeInterview(interview.id)
  return { action: 'STOP', reason: serverText().interviewLongEnough, round: planned.length === 0 ? 'empty' : 'done' }
}

// One question about one thing the map shows: a defence of their work when
// the doubt is whose it was, else the planner's, about that alone.
async function roundTurn(candidateId: string, interviewId: string, everyTurn: InterviewTurnRow[], gap: UncertaintyRow): Promise<InterviewTurnRow | null> {
  const base = { id: newId('turn'), interview_id: interviewId, idx: everyTurn.length, target_uncertainty_ids: JSON.stringify([gap.id]) }
  if (gap.kind === 'ATTRIBUTION') {
    const defence = await planDefenceQuestion(candidateId)
    if (!defence) return null
    return insertTurn({
      ...base,
      question: defence.question,
      question_reason: defence.reason,
      target_capability_ids: JSON.stringify(defence.capabilityIds),
      kind: 'defence',
      target_evidence_ids: JSON.stringify(defence.evidenceIds),
    })
  }
  const capabilities = listCapabilities(candidateId).filter((capability) => gap.capability_id === null || capability.id === gap.capability_id)
  const { data } = await runPlanNextQuestionTask({
    candidateId,
    capabilities: capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      assessment: capability.assessment,
      reason: capability.reason.slice(0, 200),
      uncertaintyIds: capability.id === gap.capability_id ? [gap.id] : [],
    })),
    uncertainties: [{ id: gap.id, capabilityId: gap.capability_id, description: gap.description, materiality: gap.materiality }],
    resolvedUncertaintyIds: listUncertainties(candidateId, 'RESOLVED').map((uncertainty) => uncertainty.id),
    recentTurns: everyTurn.slice(-6).map((turn) => ({
      question: turn.question ?? '',
      answer: turn.answer === null ? '(asked, not answered yet: do not ask about this again)' : turn.answer.slice(0, 2000),
    })),
    questionsAsked: asked(everyTurn).length,
    minimumTarget: 1,
    lookingFor: lookingFor(candidateId),
  })
  if (data.action === 'STOP' || !data.question) return null
  return insertTurn({
    ...base,
    question: data.question,
    question_reason: data.reason,
    target_capability_ids: JSON.stringify(gap.capability_id ? [gap.capability_id] : data.targetCapabilityIds),
  })
}

// Right after their sources are read: both setup questions planned, the
// second aware of the first, so neither waits when its moment comes.
export function prepareSetupQuestions(candidateId: string): Promise<void> {
  return inLine(`plan:${candidateId}`, async () => {
    const interview = getOrCreateInterview(candidateId)
    while (asked(listTurns(interview.id)).length < SETUP_QUESTIONS) {
      const planned = await planOne(candidateId, true)
      if (planned.action === 'STOP') break
    }
  })
}

async function planOne(candidateId: string, setup: boolean): Promise<NextQuestion> {
  const interview = getOrCreateInterview(candidateId)
  // Every turn keeps its place (idx); only questions count as asked.
  const everyTurn = listTurns(interview.id)
  const turns = asked(everyTurn)
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
        idx: everyTurn.length,
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
  const recentTurns = everyTurn.slice(-6).map((turn) => ({
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
    idx: everyTurn.length,
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

// The first read starts while the setup's questions are answered: their
// answers then come after its first judgments. Later answers (an interview
// question on WhatsApp, days on) wait for the next pass, as any change does.
const SETUP_READ_MS = 15 * 60 * 1000

function firstReadJustRan(candidateId: string): boolean {
  const first = getDb().prepare('SELECT MIN(created_at) AS at FROM opportunity_matches WHERE candidate_id = ?').get(candidateId) as { at: string | null }
  return first.at !== null && Date.now() - Date.parse(first.at) < SETUP_READ_MS
}

function rereadSoon(candidateId: string): void {
  void import('../matching/run').then(({ requestReread }) => requestReread(candidateId)).catch(() => undefined)
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
      // Every question answered and taken in: the first read, if it has not
      // run; if it started while they answered the setup's questions, read
      // again with what they said.
      if (left <= 0 && !hasUnansweredQuestion(candidateId)) {
        if (firstReadJustRan(candidateId)) rereadSoon(candidateId)
        else startFirstReadSoon(candidateId)
      }
    }
  })
}

// What a note's turn tells the extraction: nothing was asked.
const TOLD_REASON = 'Nothing was asked: they told their Rep this on WhatsApp, to add it to their profile. Extract only what they assert about themselves.'
const CORRECTED_REASON =
  "Nothing was asked: on WhatsApp they corrected their profile, and what they said was not true of them has been removed. Extract only what they now assert about themselves; what they deny, or say was someone else's, is not a claim about them."

function noteTurn(candidateId: string, question: string, reason: string, capabilityIds: string[]): InterviewTurnRow {
  const interview = getOrCreateInterview(candidateId)
  return insertTurn({
    id: newId('turn'),
    interview_id: interview.id,
    idx: listTurns(interview.id).length,
    question,
    question_reason: reason,
    target_capability_ids: JSON.stringify(capabilityIds),
    target_uncertainty_ids: '[]',
    kind: NOTE,
  })
}

// Something about their work they told the Rep on WhatsApp: taken in as an
// answer is (the same extraction, nothing they did not say), on its own turn.
export function takeToldNote(candidateId: string, words: string, then?: (result: IncorporatedAnswer) => Promise<void>): string {
  const turn = noteTurn(candidateId, serverText().toldOnWhatsApp, TOLD_REASON, [])
  takeAnswer(candidateId, turn.id, words, then)
  return turn.id
}

// An answer, on WhatsApp, to something their map shows as still unknown,
// without being asked it there (#23): taken in as the answer to a question
// about it, so it can settle it, as the interview's own answers do.
const GAP_REASON = 'Not asked by the Rep: their profile showed this as still unknown, and they answered it on WhatsApp.'

export function takeGapAnswer(
  candidateId: string,
  uncertainty: { id: string; capability_id: string | null; description: string },
  words: string,
  then?: (result: IncorporatedAnswer) => Promise<void>,
): string {
  const interview = getOrCreateInterview(candidateId)
  const turn = insertTurn({
    id: newId('turn'),
    interview_id: interview.id,
    idx: listTurns(interview.id).length,
    question: uncertainty.description,
    question_reason: GAP_REASON,
    target_capability_ids: JSON.stringify(uncertainty.capability_id ? [uncertainty.capability_id] : []),
    target_uncertainty_ids: JSON.stringify([uncertainty.id]),
  })
  takeAnswer(candidateId, turn.id, words, then)
  return turn.id
}

// Proof of one capability they added from their map (#24): taken in as
// what they told about it, aimed at it, so it is weighed again with it.
const MAP_NOTE_REASON =
  'Nothing was asked: on their profile they added this as proof of one capability ({name}). Extract only what they assert about themselves.'

export function takeMapNote(
  candidateId: string,
  capability: { id: string; name: string },
  words: string,
  then?: (result: IncorporatedAnswer) => Promise<void>,
): string {
  const turn = noteTurn(candidateId, serverText().toldOnMap(capability.name), MAP_NOTE_REASON.replace('{name}', capability.name), [capability.id])
  takeAnswer(candidateId, turn.id, words, then)
  return turn.id
}

// A correction they confirmed. What it makes untrue leaves their map at once
// (retracted, never deleted: the record keeps what was believed and why it
// stopped), and their words are then taken in as a note: the right version,
// if they gave it, is added, and what rested on what went is weighed again.
export function takeCorrection(
  candidateId: string,
  retract: { evidenceId: string; reason: string }[],
  words: string,
  then?: (result: IncorporatedAnswer) => Promise<void>,
): { turnId: string; retracted: number } {
  const wanted = new Set(retract.map((item) => item.evidenceId))
  const capabilityIds = [...listCapabilityEvidenceIds(candidateId)].filter(([, ids]) => ids.some((id) => wanted.has(id))).map(([id]) => id)
  const turn = noteTurn(candidateId, serverText().correctedOnWhatsApp, CORRECTED_REASON, capabilityIds)
  let retracted = 0
  for (const item of retract) {
    const evidence = getEvidence(item.evidenceId)
    if (!evidence || evidence.candidate_id !== candidateId || evidence.retracted_at !== null) continue
    retractEvidence({ evidence, reason: item.reason, question: turn.question, answer: words, turnId: turn.id })
    retracted++
  }
  // A capability with nothing left under it drops now, not after the reassessment.
  reconcileCapabilities(candidateId)
  takeAnswer(candidateId, turn.id, words, then)
  return { turnId: turn.id, retracted }
}

// Other work on their map (a document read after the setup) waits in the
// same line as answers being taken in: never two at once on one map.
export function alongAnswers<T>(candidateId: string, work: () => Promise<T>): Promise<T> {
  return inLine(`answers:${candidateId}`, work)
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
  // A note that added nothing and touched nothing leaves the map as it was:
  // it is no reason to weigh all of it again.
  if (turn.kind === NOTE && evidenceIds.length === 0 && targetCapabilityIds.length === 0) {
    return { claimsCreated, evidenceCreated: 0, resolvedUncertaintyIds: [], reassessedCapabilityIds: [], profileNeedsRefresh: false }
  }

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

    // One answer brings at most one new question to the map, the one that
    // matters most (#22): each answer used to open as many as it settled.
    // Those that matter little are kept, and the map does not show them.
    const weight: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    let shownOpened = 0
    for (const uncertainty of [...reassessData.newUncertainties].sort((a, b) => (weight[a.materiality] ?? 3) - (weight[b.materiality] ?? 3))) {
      if (uncertaintyExistsByDescription(candidateId, uncertainty.description)) continue
      if (uncertainty.materiality !== 'LOW' && shownOpened++ >= MAX_NEW_GAPS_PER_ANSWER) continue
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
