import { z } from 'zod'
import { runStructuredTask } from '../model/provider'
import {
  getEvidence,
  listCapabilityEvidenceIds,
  listUndefendedAssistedEvidence,
  markEvidenceDefended,
  markEvidencePartial,
  parseJsonArray,
  retractEvidence,
  type EvidenceRow,
  type InterviewTurnRow,
} from '../db/repo'

// Defence questions (PRODUCT_SPEC §10.2). Gap questions fill what is missing;
// defence questions verify what is already there. They are the only mechanism
// that promotes an assisted claim, and they must run before any company sees
// the profile: unverified assisted evidence fails in the flattering direction.

const MAX_EVIDENCE_IN_PROMPT = 30
const MAX_TARGETS_PER_QUESTION = 4

export type DefenceOutcome = 'defended' | 'partial' | 'failed'

export interface DefencePlan {
  question: string
  reason: string
  evidenceIds: string[]
  capabilityIds: string[]
}

export interface DefenceResult {
  defended: string[]
  partial: string[]
  retracted: string[]
  affectedCapabilityIds: string[]
}

const planDefenceOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    return {
      question: typeof obj.question === 'string' ? obj.question.trim().slice(0, 600) : '',
      reason: typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 400) : '',
      evidenceIds: Array.isArray(obj.evidenceIds)
        ? obj.evidenceIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_TARGETS_PER_QUESTION)
        : [],
    }
  },
  z.object({
    question: z.string().min(10).max(600),
    reason: z.string().min(3).max(400),
    evidenceIds: z.array(z.string().min(1)).min(1).max(MAX_TARGETS_PER_QUESTION),
  }),
)

const judgeDefenceOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const list = Array.isArray(obj.outcomes) ? obj.outcomes : []
    return {
      outcomes: list
        .map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>
          const outcome = typeof e.outcome === 'string' ? e.outcome.toLowerCase().trim() : ''
          return {
            evidenceId: typeof e.evidenceId === 'string' ? e.evidenceId : '',
            // An unreadable verdict must never promote. It leaves the claim where it was.
            outcome: outcome === 'defended' || outcome === 'failed' ? outcome : 'partial',
            reason: typeof e.reason === 'string' && e.reason.trim() ? e.reason.trim().slice(0, 400) : 'Sin motivo indicado.',
          }
        })
        .filter((entry) => entry.evidenceId.length > 0),
    }
  },
  z.object({
    outcomes: z.array(
      z.object({
        evidenceId: z.string().min(1),
        outcome: z.enum(['defended', 'partial', 'failed']),
        reason: z.string().min(1).max(400),
      }),
    ),
  }),
)

const PLAN_SYSTEM_PROMPT = `You are Amble's defence-question planner, version 2.

The evidence below was read from work the candidate produced together with an AI tool, most often code. It proves that something shipped. It does not prove whose judgment it represents. Your job is to write ONE question that lets the candidate show the judgment is theirs.

Rules:
- Anchor the question in ONE concrete decision visible in the evidence: a boundary, a trade-off, something included or deliberately left out. Name the artifact.
- Ask WHY, never WHAT. "What does X do" can be answered by reading the code; "why is the line there and not elsewhere" cannot.
- Prefer decisions that look like product or architecture judgment over trivia. Never quiz syntax, APIs or language details.
- One question, maximum 50 words. You may put one short sentence of context before it.
- Tone: you are checking your own understanding, not examining the person. "I don't know" must feel like a normal answer.
- evidenceIds: the 1 to ${MAX_TARGETS_PER_QUESTION} evidence items that this single answer would confirm or defeat. Only IDs you were given. Target items that assert the candidate's JUDGMENT or skill; items that merely record an outcome (a repo exists, something was published) survive attribution and need no defence.
- reason: one sentence on what the answer will settle.
- Write the question in the same language as the evidence statements.
- Respond ONLY with JSON: {"question": string, "reason": string, "evidenceIds": string[]}.`

const JUDGE_SYSTEM_PROMPT = `You are Amble's defence judge, version 2.

The candidate was asked to justify a decision visible in work they co-produced with an AI tool. For EACH evidence item listed, decide whether their answer shows the judgment behind it is theirs.

Outcomes:
- "defended": the answer gives their own reasoning for the decision — the why, the alternative they rejected, the constraint that forced it. Restating what the artifact does is NOT a defence.
- "partial": they know what was decided but not why, the decision was shared with the tool or someone else, or the answer covers the item only indirectly.
- "failed": they say they don't know, that the tool decided, or the answer contradicts the claim.

Separate outcome from judgment. Some items assert an OUTCOME the candidate drove ("fixed the macOS installer", "shipped X"); others assert JUDGMENT ("chose to run the real installer in CI because..."). Attribution never erases an outcome the candidate chose and shipped. If the answer confirms they asked for, directed or shipped the outcome but cannot explain the decisions inside it, the outcome item is "partial", not "failed". Reserve "failed" for judgment items they cannot own, and for items the answer contradicts.

Be strict in the flattering direction and generous in the other: when unsure between defended and partial, choose partial. An honest "no idea" is a useful result, not a fault of the candidate — the system was wrong, not them. Judge only the listed items.

reason: one sentence in Spanish quoting or paraphrasing the part of the answer you relied on.

Respond ONLY with JSON: {"outcomes": [{"evidenceId": string, "outcome": "defended"|"partial"|"failed", "reason": string}]}.`

function evidenceForPrompt(items: EvidenceRow[]) {
  return items.map((item) => ({
    id: item.id,
    statement: item.statement,
    sourceExcerpt: item.source_excerpt ? item.source_excerpt.slice(0, 300) : null,
  }))
}

function capabilitiesFor(candidateId: string, evidenceIds: string[]): string[] {
  const wanted = new Set(evidenceIds)
  const result: string[] = []
  for (const [capabilityId, ids] of listCapabilityEvidenceIds(candidateId)) {
    if (ids.some((id) => wanted.has(id))) result.push(capabilityId)
  }
  return result
}

export function hasUndefendedAssistedEvidence(candidateId: string): boolean {
  return listUndefendedAssistedEvidence(candidateId).length > 0
}

export async function planDefenceQuestion(candidateId: string): Promise<DefencePlan | null> {
  const pending = listUndefendedAssistedEvidence(candidateId)
  if (pending.length === 0) return null

  // Evidence that backs a capability matters first: that is what a company reads.
  const linked = new Set([...listCapabilityEvidenceIds(candidateId).values()].flat())
  const ordered = [...pending.filter((item) => linked.has(item.id)), ...pending.filter((item) => !linked.has(item.id))]
  const shown = ordered.slice(0, MAX_EVIDENCE_IN_PROMPT)
  const validIds = new Set(shown.map((item) => item.id))

  const { data } = await runStructuredTask({
    candidateId,
    task: 'plan_defence_question',
    version: 'v2',
    system: PLAN_SYSTEM_PROMPT,
    user: `ASSISTED EVIDENCE AWAITING DEFENCE (${shown.length} of ${pending.length}):\n${JSON.stringify(evidenceForPrompt(shown), null, 1)}`,
    schema: planDefenceOutputSchema,
    temperature: 0.3,
  })

  const evidenceIds = data.evidenceIds.filter((id) => validIds.has(id))
  if (evidenceIds.length === 0) return null

  return {
    question: data.question,
    reason: data.reason,
    evidenceIds,
    capabilityIds: capabilitiesFor(candidateId, evidenceIds),
  }
}

export async function judgeDefenceAnswer(
  candidateId: string,
  turn: InterviewTurnRow,
  answer: string,
): Promise<DefenceResult> {
  const targets = parseJsonArray(turn.target_evidence_ids)
    .map((id) => getEvidence(id))
    .filter((item): item is EvidenceRow => item !== undefined && item.retracted_at === null)

  const result: DefenceResult = { defended: [], partial: [], retracted: [], affectedCapabilityIds: [] }
  if (targets.length === 0) return result

  // Read before retraction removes the links.
  result.affectedCapabilityIds = capabilitiesFor(
    candidateId,
    targets.map((item) => item.id),
  )

  const { data } = await runStructuredTask({
    candidateId,
    task: 'judge_defence_answer',
    version: 'v2',
    system: JUDGE_SYSTEM_PROMPT,
    user: `QUESTION: ${turn.question ?? ''}\n\nEVIDENCE ITEMS:\n${JSON.stringify(evidenceForPrompt(targets), null, 1)}\n\nCANDIDATE ANSWER:\n${answer}`,
    schema: judgeDefenceOutputSchema,
    temperature: 0.1,
  })

  const verdicts = new Map(data.outcomes.map((entry) => [entry.evidenceId, entry]))
  for (const evidence of targets) {
    // An item the judge skipped stays partial: asked, not settled.
    const verdict = verdicts.get(evidence.id) ?? { outcome: 'partial' as const, reason: 'La respuesta no cubrió este punto.' }
    if (verdict.outcome === 'defended') {
      markEvidenceDefended(evidence.id, turn.id)
      result.defended.push(evidence.id)
    } else if (verdict.outcome === 'failed') {
      retractEvidence({ evidence, reason: verdict.reason, question: turn.question, answer, turnId: turn.id })
      result.retracted.push(evidence.id)
    } else {
      markEvidencePartial(evidence.id, turn.id)
      result.partial.push(evidence.id)
    }
  }

  return result
}
