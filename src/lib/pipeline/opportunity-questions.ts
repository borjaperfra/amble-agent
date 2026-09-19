/**
 * The one question the Rep can actually ask.
 *
 * A hold used to be a dead end. The decision said what would resolve it —
 * measured on the gap set, five out of five holds produced a usable question
 * — and then the question sat in a column and nothing carried it anywhere.
 * Five of those five were addressed to the company, which Amble cannot
 * reach. This is the other kind: the gap is about the person, and the person
 * is right here, and this is their Rep.
 *
 * What makes it worth building first is not this loop. It is that the loop
 * is the same shape as the one that matters later: a question leaves, an
 * answer comes back, the graph changes, and the decision is taken again.
 * Put an agent at the far end instead of a person and the machinery does not
 * change — only who is being asked.
 */

import { unknownBehind } from '@/domains/opportunity/rules'
import type { MatchAnalysis, NextBestAction } from '@/domains/opportunity/types'
import {
  getOpportunity,
  getQuestion,
  insertQuestion,
  listOpenQuestions,
  listQuestionsFor,
  recordAuditEvent,
  recordQuestionAnswer,
  recordQuestionEvidence,
  type OpportunityQuestionRow,
} from '../db/opportunities'
import { incorporateAnswer } from './interview'
import { enqueue } from './jobs'

export interface AskedQuestion {
  question: OpportunityQuestionRow
  created: boolean
}

/**
 * Write the question down, once.
 *
 * Asked at the moment the decision is settled rather than when somebody
 * opens a screen: the whole point is that they do not have to be looking.
 */
export function askCandidate(input: {
  candidateId: string
  opportunityId: string
  decisionId: string | null
  analysis: MatchAnalysis
  action: NextBestAction
}): AskedQuestion | null {
  const text = (input.action.question ?? '').trim()
  if (input.action.type !== 'ASK_CANDIDATE' || text.length === 0) return null

  const opportunity = getOpportunity(input.opportunityId)
  if (!opportunity) return null

  const unknown = unknownBehind(input.analysis, text)
  const result = insertQuestion({
    candidate_id: input.candidateId,
    opportunity_id: input.opportunityId,
    decision_id: input.decisionId,
    unknown_id: unknown?.id ?? null,
    question: text,
    // Why it is being asked, in terms of the job rather than of the gap:
    // "we are unsure about your community work" is our filing, and
    // "Solenne wants somebody who has run one" is the reason.
    reason:
      unknown?.description ??
      `${opportunity.role} at ${opportunity.company} turns on something the evidence does not settle.`,
  })

  if (result.created) {
    recordAuditEvent({
      candidate_id: input.candidateId,
      subject_type: 'opportunity',
      subject_id: input.opportunityId,
      event: 'question_asked',
      detail: { questionId: result.question.id, unknownId: unknown?.id ?? null, question: text },
    })
  }
  return { question: result.question, created: result.created }
}

/** The one to put in front of them, if any. Oldest first. */
export function openQuestionFor(candidateId: string): OpportunityQuestionRow | null {
  return listOpenQuestions(candidateId)[0] ?? null
}

export function questionsFor(opportunityId: string): OpportunityQuestionRow[] {
  return listQuestionsFor(opportunityId)
}

/**
 * Take the answer and get out of the way.
 *
 * Stored before anything else happens: reading it into the graph takes forty
 * seconds and a model, and losing what somebody typed because a network call
 * failed afterwards would be unforgivable. The rest goes on the queue.
 */
export function answerQuestion(
  questionId: string,
  answer: string,
): { ok: true; questionId: string } | { ok: false; error: string } {
  const question = getQuestion(questionId)
  if (!question) return { ok: false, error: 'That question is not here.' }
  if (question.status !== 'open') return { ok: true, questionId }

  const text = answer.trim()
  if (text.length === 0) return { ok: false, error: 'There is nothing in that answer.' }

  recordQuestionAnswer(questionId, text)
  recordAuditEvent({
    candidate_id: question.candidate_id,
    subject_type: 'opportunity',
    subject_id: question.opportunity_id,
    event: 'question_answered',
    detail: { questionId, chars: text.length },
  })

  enqueue('incorporate_opportunity_answer', question.candidate_id, { questionId })
  return { ok: true, questionId }
}

/**
 * The queue's side: read the answer into the graph, then decide again.
 *
 * The evidence takes the same path an interview answer takes — a claim with
 * provenance, evidence, capabilities reassessed — because a thing somebody
 * told their Rep is a thing their Rep knows, whatever screen it arrived on.
 * It shows up on the Map like everything else.
 *
 * Then, and only then, the opportunity is evaluated again. The posting has
 * not changed, so the rubric is not paid for twice; what changed is the
 * person, which is the half the assessment reads.
 */
export async function incorporateQuestionAnswerJob(questionId: string): Promise<void> {
  const question = getQuestion(questionId)
  if (!question) throw new Error(`Question ${questionId} is gone.`)
  if (!question.answer) throw new Error(`Question ${questionId} has no answer to work from.`)

  const incorporated = await incorporateAnswer(
    question.candidate_id,
    {
      id: question.id,
      question: question.question,
      reason: question.reason,
      targetCapabilityIds: [],
      label: 'a question about an opportunity',
    },
    question.answer,
  )

  recordQuestionEvidence(questionId, [])
  recordAuditEvent({
    candidate_id: question.candidate_id,
    subject_type: 'opportunity',
    subject_id: question.opportunity_id,
    event: 'answer_incorporated',
    detail: {
      questionId,
      claims: incorporated.claimsCreated,
      evidence: incorporated.evidenceCreated,
      resolvedUncertainties: incorporated.resolvedUncertaintyIds.length,
      reassessedCapabilities: incorporated.reassessedCapabilityIds.length,
    },
  })

  enqueue('evaluate_opportunity', question.candidate_id, {
    opportunityId: question.opportunity_id,
    reassess: true,
  })
}
