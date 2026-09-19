/**
 * The domain half of Opportunity Zero.
 *
 * The model proposes; this decides. Everything in here is pure and takes no
 * dependency on the database, the provider or Next, so the rules that
 * protect someone's attention can be read — and tested — on their own.
 *
 * Three ideas run through all of it:
 *   1. A positive claim must point at something. Evidence ids for what the
 *      person can do, intent ids for what they said they want. A claim that
 *      points at nothing is not a mismatch, it is an unknown.
 *   2. Missing information is never evidence of mismatch. It is a reason to
 *      hold, and it must come with what would resolve it.
 *   3. Interrupting is the expensive move. It has to be earned twice: once
 *      on evidence, once on intent.
 */

import { MATERIAL_IMPORTANCE } from './types'
import type {
  CandidateResponse,
  Decision,
  EvidenceMatchItem,
  Explanation,
  HardConstraintCheck,
  Importance,
  IntentMatchItem,
  IntentReference,
  InterruptionDecision,
  MatchAnalysis,
  Materiality,
  NextBestAction,
  OpportunityRubric,
  UnknownItem,
  UnsupportedClaim,
  WorkModel,
} from './types'

/**
 * The checkable half of what the candidate wants. Structurally the same as
 * the Preferences the Intent screen writes, restated here so the domain owes
 * nothing to the persistence layer.
 */
export interface CandidateConstraints {
  salaryMin: number | null
  salaryCurrency: string
  workMode: WorkModel | null
  location: string | null
  technologies: string[]
  stages: string[]
}

export interface CandidateSide {
  constraints: CandidateConstraints
  intentReferences: IntentReference[]
  /** Every evidence id that exists for this candidate. */
  evidenceIds: readonly string[]
  /** Every capability id that exists for this candidate. */
  capabilityIds: readonly string[]
}

// ─── Intent, made citable ─────────────────────────────────────────────────

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
}

/**
 * Turn the Intent Profile and the preferences into a list of things that can
 * be cited by id.
 *
 * Ids are derived from the content rather than generated, so the same intent
 * produces the same references on every run and two runs can be compared.
 */
export function intentReferencesFrom(input: {
  groups: { label: string; values: string[] }[]
  listeningFor: string[]
  constraints: CandidateConstraints
}): IntentReference[] {
  const refs: IntentReference[] = []
  const seen = new Set<string>()

  const push = (ref: IntentReference) => {
    if (seen.has(ref.id) || ref.value.trim().length === 0) return
    seen.add(ref.id)
    refs.push(ref)
  }

  for (const group of input.groups) {
    group.values.forEach((value, index) => {
      push({
        id: `int_${slug(group.label)}_${index + 1}`,
        kind: 'group',
        label: group.label,
        value,
      })
    })
  }

  input.listeningFor.forEach((value, index) => {
    push({ id: `int_listening_${index + 1}`, kind: 'listening', label: 'Listening for', value })
  })

  const { constraints } = input
  if (constraints.salaryMin !== null) {
    push({
      id: 'int_pref_salary_min',
      kind: 'preference',
      label: 'Salary floor',
      value: `${constraints.salaryMin} ${constraints.salaryCurrency}`,
    })
  }
  if (constraints.workMode) {
    push({
      id: 'int_pref_work_mode',
      kind: 'preference',
      label: 'Way of working',
      value: constraints.workMode,
    })
  }
  if (constraints.location) {
    push({ id: 'int_pref_location', kind: 'preference', label: 'Location', value: constraints.location })
  }
  constraints.technologies.forEach((value, index) => {
    push({ id: `int_pref_tech_${index + 1}`, kind: 'preference', label: 'Space', value })
  })
  constraints.stages.forEach((value, index) => {
    push({ id: `int_pref_stage_${index + 1}`, kind: 'preference', label: 'Company stage', value })
  })

  return refs
}

// ─── Unknowns that are structural rather than noticed ─────────────────────

const PRESENCE: Record<WorkModel, number> = { remote: 0, hybrid: 1, onsite: 2 }

/**
 * A material attribute the posting left out is an unknown whether or not the
 * model thought to mention it. How material depends on the candidate: an
 * undisclosed salary matters to someone who named a floor and matters much
 * less to someone who never raised it.
 */
export function structuralUnknowns(
  rubric: OpportunityRubric,
  constraints: CandidateConstraints,
): UnknownItem[] {
  const unknowns: UnknownItem[] = []
  const add = (
    id: string,
    description: string,
    materiality: Materiality,
    question: string | null,
    type: NextBestAction['type'] = 'ASK_COMPANY',
  ) =>
    unknowns.push({
      id,
      side: 'opportunity',
      description,
      materiality,
      resolvedBy: { type, question },
    })

  const compensationStated =
    rubric.compensation !== null &&
    (rubric.compensation.min !== null || rubric.compensation.max !== null)

  if (!compensationStated) {
    add(
      'unk_compensation',
      'The posting does not state what it pays.',
      constraints.salaryMin !== null ? 'HIGH' : 'MEDIUM',
      'What is the base salary range for this role?',
    )
  }
  if (!rubric.equity) {
    add('unk_equity', 'Equity is not mentioned.', 'MEDIUM', 'Is there equity, and on what terms?')
  }
  if (!rubric.workModel) {
    add(
      'unk_work_model',
      'The posting does not say whether this is remote, hybrid or on-site.',
      constraints.workMode ? 'HIGH' : 'MEDIUM',
      'Is this role remote, hybrid or on-site?',
    )
  }
  if (!rubric.location && rubric.workModel !== 'remote') {
    add(
      'unk_location',
      'The posting does not say where the role is based.',
      constraints.location ? 'HIGH' : 'MEDIUM',
      'Where is the role based?',
    )
  }
  if (!rubric.companyStage) {
    add(
      'unk_company_stage',
      'The stage and size of the company are not stated.',
      constraints.stages.length > 0 ? 'HIGH' : 'MEDIUM',
      'What stage is the company at, and how large is the team?',
      'RESEARCH',
    )
  }

  return unknowns
}

// ─── Hard constraints worked out in code ──────────────────────────────────

/**
 * The two constraints we can settle without asking a model anything: what it
 * pays against the floor the candidate named, and how much presence it
 * demands against how much they will give.
 *
 * Nothing else is computed here. Geography, role type and the candidate's
 * own hard no's live in prose, and a string comparison pretending to settle
 * them would be precision we do not have.
 */
export function deterministicHardConstraints(
  constraints: CandidateConstraints,
  rubric: OpportunityRubric,
): HardConstraintCheck[] {
  const checks: HardConstraintCheck[] = []

  if (constraints.salaryMin !== null) {
    const compensation = rubric.compensation
    const top = compensation?.max ?? compensation?.min ?? null
    const currency = compensation?.currency ?? null
    const constraint = `At least ${constraints.salaryMin.toLocaleString('en-GB')} ${constraints.salaryCurrency}`

    if (top === null) {
      checks.push({
        id: 'hc_salary',
        constraint,
        verdict: 'UNKNOWN',
        basis: compensation?.stated
          ? `The posting says "${compensation.stated}", which is not a number to compare against.`
          : 'The posting does not state what it pays.',
        intentRefs: ['int_pref_salary_min'],
        evidenceIds: [],
        deterministic: true,
      })
    } else if (currency && currency.toUpperCase() !== constraints.salaryCurrency.toUpperCase()) {
      // Converting currencies here would invent a rate and then fail somebody on it.
      checks.push({
        id: 'hc_salary',
        constraint,
        verdict: 'UNKNOWN',
        basis: `The posting pays in ${currency} and the floor is in ${constraints.salaryCurrency}. Not comparable without a rate.`,
        intentRefs: ['int_pref_salary_min'],
        evidenceIds: [],
        deterministic: true,
      })
    } else {
      const passes = top >= constraints.salaryMin
      checks.push({
        id: 'hc_salary',
        constraint,
        verdict: passes ? 'PASS' : 'FAIL',
        basis: `The posting tops out at ${top.toLocaleString('en-GB')} ${currency ?? constraints.salaryCurrency}.`,
        intentRefs: ['int_pref_salary_min'],
        evidenceIds: [],
        deterministic: true,
      })
    }
  }

  if (constraints.workMode) {
    const wanted = constraints.workMode
    const offered = rubric.workModel
    if (!offered) {
      checks.push({
        id: 'hc_work_mode',
        constraint: `Works ${wanted}`,
        verdict: 'UNKNOWN',
        basis: 'The posting does not say how the work is done.',
        intentRefs: ['int_pref_work_mode'],
        evidenceIds: [],
        deterministic: true,
      })
    } else {
      // Only more presence than they will give is a failure. A remote role
      // does not fail someone who was happy to go in.
      const demandsMore = PRESENCE[offered] > PRESENCE[wanted]
      checks.push({
        id: 'hc_work_mode',
        constraint: `Works ${wanted}`,
        verdict: demandsMore ? 'FAIL' : 'PASS',
        basis: demandsMore
          ? `The role is ${offered}, which asks for more presence than ${wanted}.`
          : `The role is ${offered}.`,
        intentRefs: ['int_pref_work_mode'],
        evidenceIds: [],
        deterministic: true,
      })
    }
  }

  return checks
}

// ─── Validation: what the model proposed, held to the ids it was given ────

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const isMaterial = (importance: Importance) => MATERIAL_IMPORTANCE.includes(importance)

export interface ProposedAnalysis {
  hardConstraints: HardConstraintCheck[]
  evidenceMatch: EvidenceMatchItem[]
  intentMatch: IntentMatchItem[]
  unknowns: UnknownItem[]
}

/**
 * Hold the proposal to the ids it was handed, then fold in what domain code
 * already knows.
 *
 * Downgrades go one way only. A positive verdict that cites nothing real
 * becomes UNKNOWN, never NOT_SUPPORTED: the model failing to cite something
 * says nothing about whether the person can do the work.
 */
export function validateAnalysis(
  proposed: ProposedAnalysis,
  side: CandidateSide,
  rubric: OpportunityRubric,
): MatchAnalysis {
  const evidenceIds = new Set(side.evidenceIds)
  const capabilityIds = new Set(side.capabilityIds)
  const intentIds = new Set(side.intentReferences.map((ref) => ref.id))
  const requirementIds = new Set(rubric.requirements.map((requirement) => requirement.id))

  const deterministic = deterministicHardConstraints(side.constraints, rubric)
  const deterministicIds = new Set(deterministic.map((check) => check.id))

  const modelConstraints = proposed.hardConstraints
    .filter((check) => !deterministicIds.has(check.id))
    .map((check): HardConstraintCheck => {
      const intentRefs = check.intentRefs.filter((ref) => intentIds.has(ref))
      const evidence = check.evidenceIds.filter((id) => evidenceIds.has(id))
      // A hard constraint is the candidate's, not the company's. If it cannot
      // be traced back to something they said, it cannot fail the opportunity.
      const traceable = intentRefs.length > 0 || evidence.length > 0
      return {
        ...check,
        intentRefs,
        evidenceIds: evidence,
        verdict: traceable ? check.verdict : 'UNKNOWN',
        basis: traceable
          ? check.basis
          : `${check.basis} (Left unknown: nothing the candidate said backs this constraint.)`,
        deterministic: false,
      }
    })

  const evidenceMatch = proposed.evidenceMatch
    .filter((item) => requirementIds.size === 0 || requirementIds.has(item.requirementId))
    .map((item): EvidenceMatchItem => {
      const cited = item.evidenceIds.filter((id) => evidenceIds.has(id))
      const capabilities = item.capabilityIds.filter((id) => capabilityIds.has(id))
      const positive = item.verdict === 'SUPPORTED' || item.verdict === 'PARTIALLY_SUPPORTED'
      const grounded = cited.length > 0
      return {
        ...item,
        evidenceIds: cited,
        capabilityIds: capabilities,
        verdict: positive && !grounded ? 'UNKNOWN' : item.verdict,
        note:
          positive && !grounded
            ? `${item.note} (Left unknown: no evidence was cited for this.)`
            : item.note,
      }
    })

  const intentMatch = proposed.intentMatch.map((item): IntentMatchItem => {
    const refs = item.intentRefs.filter((ref) => intentIds.has(ref))
    const grounded = refs.length > 0
    return {
      ...item,
      intentRefs: refs,
      verdict: grounded ? item.verdict : 'UNKNOWN',
      note: grounded
        ? item.note
        : `${item.note} (Left unknown: nothing in the intent profile backs this.)`,
    }
  })

  // Structural unknowns first, so an attribute the posting simply does not
  // have keeps its canonical id however the model chose to word it.
  const unknowns: UnknownItem[] = []
  const unknownKeys = new Set<string>()
  const addUnknown = (item: UnknownItem) => {
    const key = normalizeKey(item.description)
    if (key.length === 0 || unknownKeys.has(key)) return
    unknownKeys.add(key)
    unknowns.push(item)
  }
  for (const item of structuralUnknowns(rubric, side.constraints)) addUnknown(item)
  proposed.unknowns.forEach((item, index) => {
    addUnknown({ ...item, id: item.id || `unk_model_${index + 1}` })
  })

  return {
    hardConstraints: [...deterministic, ...modelConstraints],
    evidenceMatch,
    intentMatch,
    unknowns,
  }
}

// ─── The signals a decision rests on ──────────────────────────────────────

export interface DecisionSignals {
  hardFails: HardConstraintCheck[]
  /** Unknowns weighty enough to stop an interruption on their own. */
  blockingUnknowns: UnknownItem[]
  /** A material requirement met, with evidence behind it. */
  groundedSupport: EvidenceMatchItem[]
  alignedIntent: IntentMatchItem[]
  misalignedIntent: IntentMatchItem[]
  /** Anything at all pointing the right way. */
  positiveSignal: boolean
  interruptReady: boolean
}

export function decisionSignals(analysis: MatchAnalysis): DecisionSignals {
  const hardFails = analysis.hardConstraints.filter((check) => check.verdict === 'FAIL')
  const blockingUnknowns = analysis.unknowns.filter((item) => item.materiality === 'HIGH')

  const groundedSupport = analysis.evidenceMatch.filter(
    (item) =>
      item.verdict === 'SUPPORTED' && item.evidenceIds.length > 0 && isMaterial(item.importance),
  )
  const anySupport = analysis.evidenceMatch.some(
    (item) =>
      (item.verdict === 'SUPPORTED' || item.verdict === 'PARTIALLY_SUPPORTED') &&
      item.evidenceIds.length > 0,
  )
  const alignedIntent = analysis.intentMatch.filter(
    (item) => item.verdict === 'ALIGNED' && item.intentRefs.length > 0,
  )
  const misalignedIntent = analysis.intentMatch.filter((item) => item.verdict === 'MISALIGNED')
  const softAlignment = analysis.intentMatch.some(
    (item) => item.verdict === 'PARTIALLY_ALIGNED' && item.intentRefs.length > 0,
  )

  return {
    hardFails,
    blockingUnknowns,
    groundedSupport,
    alignedIntent,
    misalignedIntent,
    positiveSignal: anySupport || alignedIntent.length > 0 || softAlignment,
    // Earned twice. A capability match with nothing they want, or a wish
    // with nothing behind it, is not worth a message.
    interruptReady:
      groundedSupport.length > 0 && alignedIntent.length > 0 && misalignedIntent.length === 0,
  }
}

// ─── Settling it ──────────────────────────────────────────────────────────

export interface ProposedDecision {
  decision: Decision
  reason: string
  supportingEvidenceIds: string[]
  supportingIntentRefs: string[]
  materialUnknowns: string[]
  nextBestAction: NextBestAction
}

/**
 * The rules, applied to what the model proposed.
 *
 * Both are kept. Where they disagree is the interesting part: it is the only
 * way to find out whether the model can be trusted with this later, and the
 * only way to notice when the rules are the thing that is wrong.
 */
export function settleDecision(
  analysis: MatchAnalysis,
  proposed: ProposedDecision,
): InterruptionDecision {
  const signals = decisionSignals(analysis)
  const unknownIds = new Set(analysis.unknowns.map((item) => item.id))

  let decision: Decision = proposed.decision
  let overrideReason: string | null = null

  const move = (to: Decision, because: string) => {
    if (decision === to) return
    decision = to
    overrideReason = because
  }

  if (signals.hardFails.length > 0) {
    move(
      'IGNORE',
      `Hard constraint failed: ${signals.hardFails[0].constraint}. ${signals.hardFails[0].basis}`,
    )
  } else if (proposed.decision === 'INTERRUPT') {
    if (signals.blockingUnknowns.length > 0) {
      move('HOLD', `Material unknown: ${signals.blockingUnknowns[0].description}`)
    } else if (!signals.interruptReady) {
      move(
        'HOLD',
        signals.groundedSupport.length === 0
          ? 'No material requirement is met by evidence we can point at.'
          : signals.misalignedIntent.length > 0
            ? 'Something in it runs against what the candidate said they want.'
            : 'Nothing in the intent profile says this is what they are after.',
      )
    }
  } else if (proposed.decision === 'HOLD') {
    // Holding means waiting for something. If nothing is pointing the right
    // way and nothing material is missing, there is nothing to wait for.
    if (!signals.positiveSignal && signals.blockingUnknowns.length === 0) {
      move('IGNORE', 'Nothing supports it and nothing is missing that would change that.')
    }
  } else if (signals.positiveSignal && signals.blockingUnknowns.length > 0) {
    move('HOLD', `Not a mismatch, a gap: ${signals.blockingUnknowns[0].description}`)
  }

  const cited = proposed.materialUnknowns.filter((id) => unknownIds.has(id))
  const materialUnknowns = (
    decision === 'HOLD' ? [...cited, ...signals.blockingUnknowns.map((item) => item.id)] : cited
  ).filter((id, index, all) => all.indexOf(id) === index)

  return {
    decision,
    modelDecision: proposed.decision,
    overrideReason,
    reason: proposed.reason,
    supportingEvidenceIds: proposed.supportingEvidenceIds,
    supportingIntentRefs: proposed.supportingIntentRefs,
    materialUnknowns,
    nextBestAction: settleNextAction(decision, analysis, materialUnknowns, proposed.nextBestAction),
  }
}

/**
 * HOLD has to say what would end it. If the model did not name anything
 * usable, the unknown that caused the hold already carries the question.
 */
export function settleNextAction(
  decision: Decision,
  analysis: MatchAnalysis,
  materialUnknowns: string[],
  proposed: NextBestAction,
): NextBestAction {
  if (decision !== 'HOLD') return { type: 'NONE', question: null }

  const usable = proposed.type !== 'NONE' && (proposed.question ?? '').trim().length > 0
  if (usable) return { type: proposed.type, question: (proposed.question ?? '').trim() }

  const byId = new Map(analysis.unknowns.map((item) => [item.id, item]))
  for (const id of materialUnknowns) {
    const unknown = byId.get(id)
    if (unknown?.resolvedBy.question) return unknown.resolvedBy
  }
  const firstWithQuestion = analysis.unknowns.find((item) => item.resolvedBy.question)
  if (firstWithQuestion) return firstWithQuestion.resolvedBy

  return { type: 'WAIT', question: null }
}

// ─── The explanation, audited ─────────────────────────────────────────────

export interface ExplanationAudit {
  explanation: Explanation
  unsupported: UnsupportedClaim[]
}

/**
 * Every professional assertion has to trace to evidence, every preference
 * assertion to intent, and everything still open has to stay open.
 *
 * What cannot be traced is dropped rather than shown — and counted, because
 * the count is the measurement. Target: zero.
 */
export function auditExplanation(
  explanation: Explanation,
  side: CandidateSide,
  unknownIds: readonly string[],
): ExplanationAudit {
  const evidenceIds = new Set(side.evidenceIds)
  const intentIds = new Set(side.intentReferences.map((ref) => ref.id))
  const unknowns = new Set(unknownIds)
  const unsupported: UnsupportedClaim[] = []

  const whyShowingRefs = explanation.whyShowing.intentRefs.filter((ref) => intentIds.has(ref))
  if (whyShowingRefs.length === 0) {
    unsupported.push({
      where: 'whyShowing',
      text: explanation.whyShowing.text,
      why: 'Says why this is being shown without pointing at anything the candidate asked for.',
    })
  }

  const whyYou: Explanation['whyYou'] = []
  for (const claim of explanation.whyYou) {
    const cited = claim.evidenceIds.filter((id) => evidenceIds.has(id))
    if (cited.length === 0) {
      unsupported.push({
        where: 'whyYou',
        text: claim.text,
        why: 'A claim about the candidate with no evidence behind it.',
      })
      continue
    }
    whyYou.push({ text: claim.text, evidenceIds: cited })
  }

  const whatToConsider: Explanation['whatToConsider'] = []
  for (const item of explanation.whatToConsider) {
    const cited = item.unknownIds.filter((id) => unknowns.has(id))
    if (cited.length === 0) {
      unsupported.push({
        where: 'whatToConsider',
        text: item.text,
        why: 'Raises something to consider that is not one of the recorded unknowns.',
      })
      continue
    }
    whatToConsider.push({ text: item.text, unknownIds: cited })
  }

  return {
    explanation: {
      headline: explanation.headline,
      whyShowing: { text: explanation.whyShowing.text, intentRefs: whyShowingRefs },
      whyYou,
      whatToConsider,
    },
    unsupported,
  }
}

// ─── What a rejection means, and what it does not ─────────────────────────

/**
 * Turning one opportunity down is not a change of mind about the shape of
 * what someone wants.
 *
 * This exists as a function so the rule has somewhere to live and something
 * to test: the response is recorded, and nothing in the Intent Profile moves
 * because of it. Whether a pattern of rejections should eventually say
 * something is a real question — and it is the candidate's answer to give,
 * not ours to infer from a single tap.
 */
export function intentChangesFromResponse(_response: CandidateResponse): null {
  return null
}
