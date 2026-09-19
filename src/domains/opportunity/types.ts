/**
 * Opportunity Zero — the vocabulary.
 *
 * The question this whole pipeline exists to answer is not "how good a match
 * is this" but "is this worth interrupting someone for". So there is no
 * score anywhere in here. There is a rubric, four separate readings of it,
 * and three states.
 */

export const IMPORTANCE = ['REQUIRED', 'HIGH', 'MEDIUM', 'LOW'] as const
export type Importance = (typeof IMPORTANCE)[number]

/** Anything below this is not worth weighing a decision on. */
export const MATERIAL_IMPORTANCE: readonly Importance[] = ['REQUIRED', 'HIGH']

export const CONSTRAINT_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'] as const
export type ConstraintVerdict = (typeof CONSTRAINT_VERDICTS)[number]

export const EVIDENCE_VERDICTS = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'NOT_SUPPORTED',
  'UNKNOWN',
] as const
export type EvidenceVerdict = (typeof EVIDENCE_VERDICTS)[number]

export const INTENT_VERDICTS = ['ALIGNED', 'PARTIALLY_ALIGNED', 'MISALIGNED', 'UNKNOWN'] as const
export type IntentVerdict = (typeof INTENT_VERDICTS)[number]

export const DECISIONS = ['IGNORE', 'HOLD', 'INTERRUPT'] as const
export type Decision = (typeof DECISIONS)[number]

export const NEXT_ACTIONS = ['ASK_COMPANY', 'ASK_CANDIDATE', 'RESEARCH', 'WAIT', 'NONE'] as const
export type NextActionType = (typeof NEXT_ACTIONS)[number]

export const MATERIALITY = ['HIGH', 'MEDIUM', 'LOW'] as const
export type Materiality = (typeof MATERIALITY)[number]

export const WORK_MODELS = ['onsite', 'hybrid', 'remote'] as const
export type WorkModel = (typeof WORK_MODELS)[number]

/** The candidate's own labels, given blind, before Amble runs. */
export const HUMAN_LABELS = ['YES', 'MAYBE', 'NO'] as const
export type HumanLabel = (typeof HUMAN_LABELS)[number]

export const CANDIDATE_RESPONSES = ['HEAR_THEM_OUT', 'NOT_FOR_ME'] as const
export type CandidateResponse = (typeof CANDIDATE_RESPONSES)[number]

// ─── The rubric ───────────────────────────────────────────────────────────

export interface RubricRequirement {
  /** req_1, req_2 … assigned in order so a run can be compared with the last. */
  id: string
  text: string
  /** What kind of thing would settle it: a capability, a piece of evidence, or a plain constraint. */
  kind: 'capability' | 'evidence' | 'constraint'
  importance: Importance
}

export interface Compensation {
  min: number | null
  max: number | null
  currency: string | null
  /** Verbatim, when the posting said something that isn't a number. */
  stated: string | null
}

/**
 * A job description reduced to what can be held against a person. Every
 * field that the posting did not state is null, and stays null: an unknown
 * salary is not a low salary.
 */
export interface OpportunityRubric {
  roleScope: string | null
  seniority: string | null
  companyStage: string | null
  industry: string | null
  location: string | null
  workModel: WorkModel | null
  compensation: Compensation | null
  equity: string | null
  environment: string[]
  requirements: RubricRequirement[]
  /** Things the posting would like but does not require. */
  preferences: string[]
  /** Material attributes the posting leaves out, in the model's words. */
  unknowns: string[]
}

// ─── What the candidate side is made of ───────────────────────────────────

/**
 * One citable thing the candidate told us they want. The model may only
 * point at these ids, the same way capability assessment may only point at
 * evidence ids — otherwise "aligns with what they're after" is unfalsifiable.
 */
export interface IntentReference {
  id: string
  kind: 'group' | 'listening' | 'preference'
  label: string
  value: string
}

// ─── The four readings ────────────────────────────────────────────────────

export interface HardConstraintCheck {
  id: string
  /** The candidate's constraint, in their terms, not the company's. */
  constraint: string
  verdict: ConstraintVerdict
  basis: string
  intentRefs: string[]
  evidenceIds: string[]
  /** True when domain code worked it out rather than the model proposing it. */
  deterministic: boolean
}

export interface EvidenceMatchItem {
  requirementId: string
  requirement: string
  importance: Importance
  verdict: EvidenceVerdict
  /** Must be real evidence ids. A positive verdict without one is downgraded. */
  evidenceIds: string[]
  capabilityIds: string[]
  note: string
}

export interface IntentMatchItem {
  id: string
  aspect: string
  verdict: IntentVerdict
  intentRefs: string[]
  note: string
}

export interface UnknownItem {
  id: string
  /** Whether the gap is in the posting or in what we know about the person. */
  side: 'opportunity' | 'candidate'
  description: string
  materiality: Materiality
  /** What would settle it. This is what makes HOLD an answer rather than a shrug. */
  resolvedBy: { type: NextActionType; question: string | null }
}

export interface MatchAnalysis {
  hardConstraints: HardConstraintCheck[]
  evidenceMatch: EvidenceMatchItem[]
  intentMatch: IntentMatchItem[]
  unknowns: UnknownItem[]
}

// ─── The decision ─────────────────────────────────────────────────────────

export interface NextBestAction {
  type: NextActionType
  question: string | null
}

export interface InterruptionDecision {
  decision: Decision
  /** What the model proposed, kept even when the rules disagreed. */
  modelDecision: Decision | null
  /** Why the rules moved it, in one line. Null when they agreed. */
  overrideReason: string | null
  reason: string
  supportingEvidenceIds: string[]
  supportingIntentRefs: string[]
  /** Ids from MatchAnalysis.unknowns, not free text. */
  materialUnknowns: string[]
  nextBestAction: NextBestAction
}

// ─── The explanation, for INTERRUPT only ──────────────────────────────────

export interface ExplanationClaim {
  text: string
  evidenceIds: string[]
}

export interface Explanation {
  headline: string
  /** Why am I showing you this? Grounded in intent. */
  whyShowing: { text: string; intentRefs: string[] }
  /** Why you? Grounded in evidence. */
  whyYou: ExplanationClaim[]
  /** What should you consider? Grounded in what is still unknown. */
  whatToConsider: { text: string; unknownIds: string[] }[]
}

/** A sentence that asserted something it could not point at. Target: zero. */
export interface UnsupportedClaim {
  where: 'whyShowing' | 'whyYou' | 'whatToConsider'
  text: string
  why: string
}
