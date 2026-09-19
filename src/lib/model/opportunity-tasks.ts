/**
 * The four Opportunity Zero model tasks, wired to the provider.
 *
 * The prompts themselves live in the domain, away from here, so that what
 * the model is shown can be tested without a provider. This file is the
 * other half: the schemas the answers have to satisfy, and the tolerant
 * normalizing that gets them there.
 *
 * The normalizing matters as much as the schema. Without server-side JSON
 * mode the field names drift between runs — a requirement came back as
 * `text` once and as `requirement` the next time — and User Zero already
 * lost two whole lists that way before anyone noticed. So: try the names we
 * know, fall back to the longest sentence in the object, and treat a list
 * that normalizes down to nothing as a schema failure rather than a result.
 */

import { z } from 'zod'
import { runStructuredTask } from './provider'
import { firstProse, normalizeList, normalizeWorkMode, toAmount } from './tasks'
import {
  buildDecisionPrompt,
  buildExplanationPrompt,
  buildMatchPrompt,
  buildRubricPrompt,
  DECISION_VERSION,
  EXPLANATION_VERSION,
  MATCH_VERSION,
  RUBRIC_VERSION,
  type DecisionInput,
  type ExplanationInput,
  type MatchInput,
  type RawOpportunity,
} from '@/domains/opportunity/prompts'
import {
  CONSTRAINT_VERDICTS,
  DECISIONS,
  EVIDENCE_VERDICTS,
  IMPORTANCE,
  INTENT_VERDICTS,
  MATERIALITY,
  NEXT_ACTIONS,
  WORK_MODELS,
} from '@/domains/opportunity/types'

// ─── Shared normalizing ───────────────────────────────────────────────────

const asRecord = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

const asArray = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : [])

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : null
}

/** An enum value however the model chose to shout it. */
function oneOf<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  if (typeof raw !== 'string') return fallback
  const upper = raw.trim().toUpperCase().replace(/\s+/g, '_')
  const hit = values.find((value) => value.toUpperCase() === upper)
  return hit ?? fallback
}

function slugId(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' ? raw : ''
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return slug.length >= 2 ? slug : fallback
}

/** Ids the model was handed back to us, in whatever shape it wrapped them. */
function idList(raw: unknown, limit = 20): string[] {
  const source = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []
  const out: string[] = []
  for (const item of source) {
    const value =
      typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null
          ? String((item as Record<string, unknown>).id ?? '')
          : ''
    const trimmed = value.trim().replace(/^["'(\[]+|["')\]]+$/g, '')
    if (trimmed.length < 2 || out.includes(trimmed)) continue
    out.push(trimmed)
    if (out.length >= limit) break
  }
  return out
}

// ─── 1. Rubric ────────────────────────────────────────────────────────────

const compensationSchema = z
  .object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: z.string().max(8).nullable(),
    stated: z.string().max(200).nullable(),
  })
  .nullable()

function normalizeCompensation(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const amount = toAmount(raw)
    return { min: amount, max: null, currency: null, stated: amount === null ? raw.slice(0, 200) : null }
  }
  const value = asRecord(raw)
  const min = toAmount(value.min ?? value.from ?? value.salaryMin ?? value.base ?? value.amount)
  const max = toAmount(value.max ?? value.to ?? value.salaryMax ?? value.upper)
  const stated = text(value.stated ?? value.text ?? value.raw ?? value.range, 200)
  if (min === null && max === null && stated === null) return null
  return {
    min,
    max: max !== null && min !== null && max < min ? min : max,
    currency: text(value.currency ?? value.salaryCurrency, 8)?.toUpperCase() ?? null,
    stated: min === null && max === null ? stated : null,
  }
}

function normalizeRequirements(raw: unknown): unknown[] {
  const out: unknown[] = []
  for (const item of asArray(raw)) {
    const value = asRecord(item)
    const body =
      typeof item === 'string'
        ? item
        : firstProse(value, ['text', 'requirement', 'description', 'name', 'title'], 4)
    if (!body || body.trim().length < 4) continue
    out.push({
      // Positional, so a rerun of the same posting produces the same ids and
      // two runs can be laid side by side.
      id: `req_${out.length + 1}`,
      text: body.trim().slice(0, 300),
      kind: oneOf(value.kind ?? value.type, ['capability', 'evidence', 'constraint'] as const, 'capability'),
      importance: oneOf(value.importance ?? value.priority ?? value.weight, IMPORTANCE, 'MEDIUM'),
    })
    if (out.length >= 12) break
  }
  return out
}

export const rubricOutputSchema = z.preprocess(
  (raw) => {
    const value = asRecord(raw)
    const nested = asRecord(value.rubric)
    const source = Object.keys(nested).length > 0 ? nested : value
    return {
      roleScope: text(source.roleScope ?? source.scope ?? source.role_scope, 300),
      seniority: text(source.seniority ?? source.level, 60),
      companyStage: text(source.companyStage ?? source.stage ?? source.company_stage, 60),
      industry: text(source.industry ?? source.domain ?? source.sector, 80),
      location: text(source.location ?? source.city ?? source.based, 120),
      workModel: normalizeWorkMode(source.workModel ?? source.work_model ?? source.remote),
      compensation: normalizeCompensation(source.compensation ?? source.salary ?? source.pay),
      equity: text(source.equity ?? source.ownership ?? source.options, 200),
      environment: normalizeList(source.environment ?? source.culture ?? source.team, 5),
      requirements: normalizeRequirements(
        source.requirements ?? source.mustHaves ?? source.must_haves ?? source.criteria,
      ),
      preferences: normalizeList(source.preferences ?? source.niceToHaves ?? source.nice_to_haves, 5),
      unknowns: normalizeList(source.unknowns ?? source.missing ?? source.notStated, 8).map((item) =>
        item.slice(0, 200),
      ),
    }
  },
  z.object({
    roleScope: z.string().max(300).nullable(),
    seniority: z.string().max(60).nullable(),
    companyStage: z.string().max(60).nullable(),
    industry: z.string().max(80).nullable(),
    location: z.string().max(120).nullable(),
    workModel: z.enum(WORK_MODELS).nullable(),
    compensation: compensationSchema,
    equity: z.string().max(200).nullable(),
    environment: z.array(z.string()).max(5),
    // A posting with no requirements at all is a parse that went wrong, not
    // a job with nothing to it. Fail loudly so the provider retries.
    requirements: z
      .array(
        z.object({
          id: z.string(),
          text: z.string().min(4).max(300),
          kind: z.enum(['capability', 'evidence', 'constraint']),
          importance: z.enum(IMPORTANCE),
        }),
      )
      .min(1)
      .max(12),
    preferences: z.array(z.string()).max(5),
    unknowns: z.array(z.string().max(200)).max(8),
  }),
)

export type RubricOutput = z.infer<typeof rubricOutputSchema>

export function runOpportunityRubricTask(params: {
  candidateId: string
  opportunity: RawOpportunity
}) {
  const { system, user } = buildRubricPrompt(params.opportunity)
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'opportunity_rubric',
    version: RUBRIC_VERSION,
    system,
    user,
    schema: rubricOutputSchema,
    temperature: 0.1,
    // Reading a document into fields. Weighing importance is the only
    // judgement in it, and it does not need a long think.
    reasoningEffort: 'medium',
  })
}

// ─── 2. Match ─────────────────────────────────────────────────────────────

function normalizeHardConstraints(raw: unknown): unknown[] {
  const out: unknown[] = []
  for (const item of asArray(raw)) {
    const value = asRecord(item)
    const constraint = firstProse(value, ['constraint', 'name', 'condition', 'text'], 3)
    if (!constraint) continue
    out.push({
      id: slugId(value.id ?? constraint, `hc_model_${out.length + 1}`),
      constraint: constraint.slice(0, 200),
      verdict: oneOf(value.verdict ?? value.result ?? value.status, CONSTRAINT_VERDICTS, 'UNKNOWN'),
      basis: firstProse(value, ['basis', 'reason', 'note', 'why'], 3)?.slice(0, 400) ?? 'No basis given.',
      intentRefs: idList(value.intentRefs ?? value.intentReferences ?? value.intent_refs),
      evidenceIds: idList(value.evidenceIds ?? value.evidence ?? value.evidence_ids),
      deterministic: false,
    })
    if (out.length >= 8) break
  }
  return out
}

function normalizeEvidenceMatch(raw: unknown): unknown[] {
  const out: unknown[] = []
  for (const item of asArray(raw)) {
    const value = asRecord(item)
    const requirement = firstProse(value, ['requirement', 'text', 'name'], 4)
    if (!requirement) continue
    out.push({
      requirementId: text(value.requirementId ?? value.requirement_id ?? value.id, 40) ?? `req_${out.length + 1}`,
      requirement: requirement.slice(0, 300),
      importance: oneOf(value.importance ?? value.priority, IMPORTANCE, 'MEDIUM'),
      verdict: oneOf(value.verdict ?? value.result ?? value.status, EVIDENCE_VERDICTS, 'UNKNOWN'),
      evidenceIds: idList(value.evidenceIds ?? value.evidence ?? value.evidence_ids, 12),
      capabilityIds: idList(value.capabilityIds ?? value.capabilities ?? value.capability_ids, 8),
      note: firstProse(value, ['note', 'reason', 'explanation'], 3)?.slice(0, 400) ?? '',
    })
    if (out.length >= 14) break
  }
  return out
}

function normalizeIntentMatch(raw: unknown): unknown[] {
  const out: unknown[] = []
  for (const item of asArray(raw)) {
    const value = asRecord(item)
    const aspect = firstProse(value, ['aspect', 'name', 'dimension', 'text'], 3)
    if (!aspect) continue
    out.push({
      id: slugId(value.id ?? aspect, `im_${out.length + 1}`),
      aspect: aspect.slice(0, 120),
      verdict: oneOf(value.verdict ?? value.result ?? value.status, INTENT_VERDICTS, 'UNKNOWN'),
      intentRefs: idList(value.intentRefs ?? value.intentReferences ?? value.intent_refs, 12),
      note: firstProse(value, ['note', 'reason', 'explanation'], 3)?.slice(0, 400) ?? '',
    })
    if (out.length >= 8) break
  }
  return out
}

function normalizeResolvedBy(raw: unknown, description: string): unknown {
  const value = asRecord(raw)
  const question = firstProse(value, ['question', 'ask', 'text'], 5)
  const type = oneOf(value.type ?? value.action ?? value.kind, NEXT_ACTIONS, question ? 'ASK_COMPANY' : 'NONE')
  return {
    type,
    // A HOLD that cannot say what would end it is not a hold, it is a shrug.
    // Falling back to the gap itself is better than leaving it blank.
    question: question ? question.slice(0, 300) : type === 'NONE' || type === 'WAIT' ? null : description.slice(0, 300),
  }
}

function normalizeUnknowns(raw: unknown): unknown[] {
  const out: unknown[] = []
  for (const item of asArray(raw)) {
    const value = asRecord(item)
    const description =
      typeof item === 'string' ? item : firstProse(value, ['description', 'text', 'unknown', 'note'], 5)
    if (!description) continue
    const body = description.trim().slice(0, 300)
    out.push({
      id: slugId(value.id ?? body, `unk_model_${out.length + 1}`),
      side: oneOf(value.side ?? value.source, ['opportunity', 'candidate'] as const, 'opportunity'),
      description: body,
      materiality: oneOf(value.materiality ?? value.importance ?? value.weight, MATERIALITY, 'MEDIUM'),
      resolvedBy: normalizeResolvedBy(value.resolvedBy ?? value.resolved_by ?? value.nextAction, body),
      deterministic: false,
    })
    if (out.length >= 10) break
  }
  return out
}

const unknownSchema = z.object({
  id: z.string(),
  side: z.enum(['opportunity', 'candidate']),
  description: z.string().min(5).max(300),
  materiality: z.enum(MATERIALITY),
  resolvedBy: z.object({
    type: z.enum(NEXT_ACTIONS),
    question: z.string().max(300).nullable(),
  }),
  deterministic: z.literal(false),
})

export const matchOutputSchema = z.preprocess(
  (raw) => {
    const value = asRecord(raw)
    return {
      hardConstraints: normalizeHardConstraints(
        value.hardConstraints ?? value.hard_constraints ?? value.constraints,
      ),
      evidenceMatch: normalizeEvidenceMatch(value.evidenceMatch ?? value.evidence_match ?? value.evidence),
      intentMatch: normalizeIntentMatch(value.intentMatch ?? value.intent_match ?? value.intent),
      unknowns: normalizeUnknowns(value.unknowns ?? value.uncertainty ?? value.uncertainties),
    }
  },
  z.object({
    hardConstraints: z
      .array(
        z.object({
          id: z.string(),
          constraint: z.string().min(3).max(200),
          verdict: z.enum(CONSTRAINT_VERDICTS),
          basis: z.string().max(400),
          intentRefs: z.array(z.string()),
          evidenceIds: z.array(z.string()),
          deterministic: z.literal(false),
        }),
      )
      .max(8),
    // These two carry the whole reading. Empty means the field names drifted
    // again and the answer fell through the normalizer, which is a schema
    // failure worth a retry — not a candidate with nothing to say for them.
    evidenceMatch: z
      .array(
        z.object({
          requirementId: z.string(),
          requirement: z.string().min(4).max(300),
          importance: z.enum(IMPORTANCE),
          verdict: z.enum(EVIDENCE_VERDICTS),
          evidenceIds: z.array(z.string()),
          capabilityIds: z.array(z.string()),
          note: z.string().max(400),
        }),
      )
      .min(1)
      .max(14),
    intentMatch: z
      .array(
        z.object({
          id: z.string(),
          aspect: z.string().min(3).max(120),
          verdict: z.enum(INTENT_VERDICTS),
          intentRefs: z.array(z.string()),
          note: z.string().max(400),
        }),
      )
      .min(1)
      .max(8),
    unknowns: z.array(unknownSchema).max(10),
  }),
)

export type MatchOutput = z.infer<typeof matchOutputSchema>

export function runOpportunityMatchTask(params: { candidateId: string; input: MatchInput }) {
  const { system, user } = buildMatchPrompt(params.input)
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'opportunity_match',
    version: MATCH_VERSION,
    system,
    user,
    schema: matchOutputSchema,
    temperature: 0.2,
    // Weighing what the evidence does and does not establish against a
    // specific job. Same call as capability assessment, same depth.
    reasoningEffort: 'high',
  })
}

// ─── 3. Decision ──────────────────────────────────────────────────────────

export const decisionOutputSchema = z.preprocess(
  (raw) => {
    const value = asRecord(raw)
    const action = asRecord(value.nextBestAction ?? value.next_best_action ?? value.nextAction)
    const question = firstProse(action, ['question', 'ask', 'text'], 5)
    return {
      decision: oneOf(value.decision ?? value.verdict ?? value.action, DECISIONS, 'HOLD'),
      reason: firstProse(value, ['reason', 'rationale', 'explanation', 'why'], 5)?.slice(0, 600) ?? '',
      supportingEvidenceIds: idList(value.supportingEvidenceIds ?? value.evidenceIds ?? value.evidence, 12),
      supportingIntentReferences: idList(
        value.supportingIntentReferences ?? value.supportingIntentRefs ?? value.intentRefs,
        12,
      ),
      materialUnknowns: idList(value.materialUnknowns ?? value.material_unknowns ?? value.unknowns, 10),
      nextBestAction: {
        type: oneOf(action.type ?? action.action ?? action.kind, NEXT_ACTIONS, question ? 'ASK_COMPANY' : 'NONE'),
        question: question ? question.slice(0, 300) : null,
      },
    }
  },
  z.object({
    decision: z.enum(DECISIONS),
    reason: z.string().min(5).max(600),
    supportingEvidenceIds: z.array(z.string()),
    supportingIntentReferences: z.array(z.string()),
    materialUnknowns: z.array(z.string()),
    nextBestAction: z.object({
      type: z.enum(NEXT_ACTIONS),
      question: z.string().max(300).nullable(),
    }),
  }),
)

export type DecisionOutput = z.infer<typeof decisionOutputSchema>

export function runInterruptionDecisionTask(params: { candidateId: string; input: DecisionInput }) {
  const { system, user } = buildDecisionPrompt(params.input)
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'opportunity_decision',
    version: DECISION_VERSION,
    system,
    user,
    schema: decisionOutputSchema,
    temperature: 0.1,
    reasoningEffort: 'high',
  })
}

// ─── 4. Explanation ───────────────────────────────────────────────────────

function normalizeClaims(raw: unknown, idKey: 'evidenceIds' | 'unknownIds'): unknown[] {
  const out: unknown[] = []
  for (const item of asArray(raw)) {
    const value = asRecord(item)
    const body = typeof item === 'string' ? item : firstProse(value, ['text', 'claim', 'point', 'note'], 8)
    if (!body) continue
    out.push({
      text: body.trim().slice(0, 400),
      [idKey]: idList(
        idKey === 'evidenceIds'
          ? (value.evidenceIds ?? value.evidence ?? value.evidence_ids)
          : (value.unknownIds ?? value.unknowns ?? value.unknown_ids),
        8,
      ),
    })
    if (out.length >= 3) break
  }
  return out
}

export const explanationOutputSchema = z.preprocess(
  (raw) => {
    const value = asRecord(raw)
    const whyShowing = asRecord(value.whyShowing ?? value.why_showing ?? value.why)
    return {
      headline: firstProse(value, ['headline', 'title', 'summary'], 4)?.slice(0, 120) ?? '',
      whyShowing: {
        text:
          (typeof (value.whyShowing ?? value.why) === 'string'
            ? String(value.whyShowing ?? value.why)
            : firstProse(whyShowing, ['text', 'reason', 'why'], 8)
          )?.slice(0, 500) ?? '',
        intentRefs: idList(whyShowing.intentRefs ?? whyShowing.intentReferences ?? value.intentRefs, 8),
      },
      whyYou: normalizeClaims(value.whyYou ?? value.why_you ?? value.because, 'evidenceIds'),
      whatToConsider: normalizeClaims(
        value.whatToConsider ?? value.what_to_consider ?? value.considerations,
        'unknownIds',
      ),
    }
  },
  z.object({
    headline: z.string().min(4).max(120),
    whyShowing: z.object({
      text: z.string().min(8).max(500),
      intentRefs: z.array(z.string()),
    }),
    whyYou: z
      .array(z.object({ text: z.string().min(8).max(400), evidenceIds: z.array(z.string()) }))
      .min(1)
      .max(3),
    whatToConsider: z
      .array(z.object({ text: z.string().min(8).max(400), unknownIds: z.array(z.string()) }))
      .max(3),
  }),
)

export type ExplanationOutput = z.infer<typeof explanationOutputSchema>

export function runOpportunityExplanationTask(params: {
  candidateId: string
  input: ExplanationInput
}) {
  const { system, user } = buildExplanationPrompt(params.input)
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'opportunity_explanation',
    version: EXPLANATION_VERSION,
    system,
    user,
    schema: explanationOutputSchema,
    temperature: 0.3,
    reasoningEffort: 'medium',
  })
}

/** Every task this pipeline runs, for the trace and the measurement harness. */
export const OPPORTUNITY_TASKS = [
  'opportunity_rubric',
  'opportunity_match',
  'opportunity_decision',
  'opportunity_explanation',
] as const
