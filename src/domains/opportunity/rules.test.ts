/**
 * The rules that protect someone's attention, tested on their own.
 *
 * No database, no provider, no network — that is why the domain has no
 * dependency on any of them. What is being pinned down here is not that the
 * code runs, but the handful of decisions in WIP.md that are not meant to be
 * reopened: a claim that points at nothing is an unknown rather than a
 * mismatch, missing information never counts as evidence against anyone, and
 * interrupting has to be earned twice.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditExplanation,
  deterministicHardConstraints,
  decisionSignals,
  intentChangesFromResponse,
  intentReferencesFrom,
  settleDecision,
  settleNextAction,
  structuralUnknowns,
  validateAnalysis,
  type CandidateConstraints,
  type CandidateSide,
  type ProposedAnalysis,
  type ProposedDecision,
} from './rules'
import type {
  EvidenceMatchItem,
  Explanation,
  IntentMatchItem,
  MatchAnalysis,
  OpportunityRubric,
  UnknownItem,
} from './types'

// ─── Fixtures small enough to read ────────────────────────────────────────

const constraints: CandidateConstraints = {
  salaryMin: 120_000,
  salaryCurrency: 'EUR',
  workMode: 'remote',
  location: 'Valencia',
  technologies: ['AI infrastructure'],
  stages: ['Seed', 'Series A'],
}

function rubric(overrides: Partial<OpportunityRubric> = {}): OpportunityRubric {
  return {
    roleScope: 'Growth leadership',
    seniority: 'Head of',
    companyStage: 'Series A',
    industry: 'Developer tools',
    location: 'Remote (EU)',
    workModel: 'remote',
    compensation: { min: 130_000, max: 150_000, currency: 'EUR', stated: null },
    equity: '0.5% - 1%',
    environment: ['small team'],
    requirements: [
      { id: 'req_1', text: 'Has run growth for a developer tool', kind: 'capability', importance: 'REQUIRED' },
      { id: 'req_2', text: 'Comfortable writing technical content', kind: 'evidence', importance: 'MEDIUM' },
    ],
    preferences: [],
    unknowns: [],
    ...overrides,
  }
}

const side: CandidateSide = {
  constraints,
  intentReferences: intentReferencesFrom({
    groups: [{ label: 'Roles', values: ['Head of Growth'] }],
    listeningFor: ['AI infrastructure'],
    constraints,
  }),
  evidenceIds: ['ev_1', 'ev_2'],
  capabilityIds: ['cap_1'],
}

function analysisWith(overrides: Partial<MatchAnalysis> = {}): MatchAnalysis {
  return {
    hardConstraints: [],
    evidenceMatch: [],
    intentMatch: [],
    unknowns: [],
    ...overrides,
  }
}

const groundedRequirement: EvidenceMatchItem = {
  requirementId: 'req_1',
  requirement: 'Has run growth for a developer tool',
  importance: 'REQUIRED',
  verdict: 'SUPPORTED',
  evidenceIds: ['ev_1'],
  capabilityIds: ['cap_1'],
  note: 'Ran growth at a developer tools company for three years.',
}

const alignedAspect: IntentMatchItem = {
  id: 'im_1',
  aspect: 'Space',
  verdict: 'ALIGNED',
  intentRefs: ['int_listening_1'],
  note: 'They said AI infrastructure and this is AI infrastructure.',
}

const proposal = (overrides: Partial<ProposedDecision> = {}): ProposedDecision => ({
  decision: 'INTERRUPT',
  reason: 'Worth a look.',
  supportingEvidenceIds: ['ev_1'],
  supportingIntentRefs: ['int_listening_1'],
  materialUnknowns: [],
  nextBestAction: { type: 'NONE', question: null },
  ...overrides,
})

// ─── Intent, made citable ─────────────────────────────────────────────────

describe('intentReferencesFrom', () => {
  it('derives ids from content, so two runs can be compared', () => {
    const once = intentReferencesFrom({
      groups: [{ label: 'Roles', values: ['Head of Growth'] }],
      listeningFor: ['AI infrastructure'],
      constraints,
    })
    const twice = intentReferencesFrom({
      groups: [{ label: 'Roles', values: ['Head of Growth'] }],
      listeningFor: ['AI infrastructure'],
      constraints,
    })
    assert.deepEqual(
      once.map((ref) => ref.id),
      twice.map((ref) => ref.id),
    )
    assert.ok(once.some((ref) => ref.id === 'int_pref_salary_min'))
    assert.ok(once.some((ref) => ref.id === 'int_listening_1'))
  })

  it('leaves out what was never said', () => {
    const refs = intentReferencesFrom({
      groups: [],
      listeningFor: ['  '],
      constraints: {
        salaryMin: null,
        salaryCurrency: 'EUR',
        workMode: null,
        location: null,
        technologies: [],
        stages: [],
      },
    })
    assert.equal(refs.length, 0)
  })
})

// ─── The two constraints code is allowed to settle ────────────────────────

describe('deterministicHardConstraints', () => {
  it('fails an offer that tops out under the floor', () => {
    const [salary] = deterministicHardConstraints(constraints, {
      ...rubric(),
      compensation: { min: 80_000, max: 95_000, currency: 'EUR', stated: null },
    })
    assert.equal(salary.verdict, 'FAIL')
    assert.equal(salary.deterministic, true)
  })

  it('leaves an unstated salary unknown rather than failing it', () => {
    const [salary] = deterministicHardConstraints(constraints, { ...rubric(), compensation: null })
    assert.equal(salary.verdict, 'UNKNOWN')
  })

  it('will not compare currencies it would have to invent a rate for', () => {
    const [salary] = deterministicHardConstraints(constraints, {
      ...rubric(),
      compensation: { min: 200_000, max: 240_000, currency: 'USD', stated: null },
    })
    assert.equal(salary.verdict, 'UNKNOWN')
    assert.match(salary.basis, /rate/)
  })

  it('quotes what the posting said when what it said is not a number', () => {
    const [salary] = deterministicHardConstraints(constraints, {
      ...rubric(),
      compensation: { min: null, max: null, currency: null, stated: 'Competitive' },
    })
    assert.equal(salary.verdict, 'UNKNOWN')
    assert.match(salary.basis, /Competitive/)
  })

  it('fails only more presence than they will give', () => {
    const wantsRemote = deterministicHardConstraints(constraints, {
      ...rubric(),
      workModel: 'onsite',
    })
    assert.equal(wantsRemote.find((check) => check.id === 'hc_work_mode')?.verdict, 'FAIL')

    const happyToGoIn = deterministicHardConstraints(
      { ...constraints, workMode: 'onsite' },
      { ...rubric(), workModel: 'remote' },
    )
    assert.equal(happyToGoIn.find((check) => check.id === 'hc_work_mode')?.verdict, 'PASS')
  })

  it('checks nothing the candidate never asked for', () => {
    const checks = deterministicHardConstraints(
      { ...constraints, salaryMin: null, workMode: null },
      rubric(),
    )
    assert.equal(checks.length, 0)
  })
})

// ─── Unknowns that exist whether or not anyone noticed them ───────────────

describe('structuralUnknowns', () => {
  it('weighs a missing salary by whether the candidate named a floor', () => {
    const named = structuralUnknowns({ ...rubric(), compensation: null }, constraints)
    assert.equal(named.find((item) => item.id === 'unk_compensation')?.materiality, 'HIGH')

    const neverRaised = structuralUnknowns({ ...rubric(), compensation: null }, {
      ...constraints,
      salaryMin: null,
    })
    assert.equal(neverRaised.find((item) => item.id === 'unk_compensation')?.materiality, 'MEDIUM')
  })

  it('does not ask where a remote role is based', () => {
    const unknowns = structuralUnknowns({ ...rubric(), location: null }, constraints)
    assert.equal(
      unknowns.find((item) => item.id === 'unk_location'),
      undefined,
    )
  })

  it('carries the question that would settle it', () => {
    const unknowns = structuralUnknowns({ ...rubric(), compensation: null }, constraints)
    const compensation = unknowns.find((item) => item.id === 'unk_compensation')
    assert.equal(compensation?.resolvedBy.type, 'ASK_COMPANY')
    assert.ok((compensation?.resolvedBy.question ?? '').length > 0)
  })
})

// ─── Holding the proposal to the ids it was handed ────────────────────────

describe('validateAnalysis', () => {
  const proposed = (overrides: Partial<ProposedAnalysis> = {}): ProposedAnalysis => ({
    hardConstraints: [],
    evidenceMatch: [],
    intentMatch: [],
    unknowns: [],
    ...overrides,
  })

  it('downgrades an uncited positive verdict to UNKNOWN, never to NOT_SUPPORTED', () => {
    const analysis = validateAnalysis(
      proposed({
        evidenceMatch: [{ ...groundedRequirement, evidenceIds: ['ev_does_not_exist'] }],
      }),
      side,
      rubric(),
    )
    assert.equal(analysis.evidenceMatch[0].verdict, 'UNKNOWN')
    assert.deepEqual(analysis.evidenceMatch[0].evidenceIds, [])
  })

  it('leaves a negative verdict alone: not citing is not the same as not having', () => {
    const analysis = validateAnalysis(
      proposed({
        evidenceMatch: [
          { ...groundedRequirement, verdict: 'NOT_SUPPORTED', evidenceIds: [], capabilityIds: [] },
        ],
      }),
      side,
      rubric(),
    )
    assert.equal(analysis.evidenceMatch[0].verdict, 'NOT_SUPPORTED')
  })

  it('drops a reading of a requirement that is not in the rubric', () => {
    const analysis = validateAnalysis(
      proposed({ evidenceMatch: [{ ...groundedRequirement, requirementId: 'req_invented' }] }),
      side,
      rubric(),
    )
    assert.equal(analysis.evidenceMatch.length, 0)
  })

  it('will not let a hard constraint fail someone on nothing they said', () => {
    const analysis = validateAnalysis(
      proposed({
        hardConstraints: [
          {
            id: 'hc_industry',
            constraint: 'No agencies',
            verdict: 'FAIL',
            basis: 'This is an agency.',
            intentRefs: ['int_nonexistent'],
            evidenceIds: [],
            deterministic: false,
          },
        ],
      }),
      side,
      rubric(),
    )
    const check = analysis.hardConstraints.find((item) => item.id === 'hc_industry')
    assert.equal(check?.verdict, 'UNKNOWN')
  })

  it('keeps the deterministic check when the model proposes one of its own', () => {
    const analysis = validateAnalysis(
      proposed({
        hardConstraints: [
          {
            id: 'hc_salary',
            constraint: 'At least 120,000 EUR',
            verdict: 'PASS',
            basis: 'Feels about right.',
            intentRefs: ['int_pref_salary_min'],
            evidenceIds: [],
            deterministic: false,
          },
        ],
      }),
      side,
      { ...rubric(), compensation: { min: 60_000, max: 70_000, currency: 'EUR', stated: null } },
    )
    const salary = analysis.hardConstraints.filter((check) => check.id === 'hc_salary')
    assert.equal(salary.length, 1)
    assert.equal(salary[0].verdict, 'FAIL')
    assert.equal(salary[0].deterministic, true)
  })

  it('never lets a model-proposed gap pass itself off as a condition', () => {
    const analysis = validateAnalysis(
      proposed({
        unknowns: [
          {
            id: 'unk_manager',
            side: 'opportunity',
            description: 'The posting does not name who the role reports to.',
            materiality: 'HIGH',
            resolvedBy: { type: 'ASK_COMPANY', question: 'Who would I report to?' },
            deterministic: true,
          },
        ],
      }),
      side,
      rubric(),
    )
    assert.equal(analysis.unknowns.find((item) => item.id === 'unk_manager')?.deterministic, false)
  })

  it('keeps the canonical id for a gap the model worded its own way', () => {
    const analysis = validateAnalysis(
      proposed({
        unknowns: [
          {
            id: 'unk_model_pay',
            side: 'opportunity',
            description: 'The posting does not state what it pays!',
            materiality: 'HIGH',
            resolvedBy: { type: 'ASK_COMPANY', question: 'What does it pay?' },
            deterministic: false,
          },
        ],
      }),
      side,
      { ...rubric(), compensation: null },
    )
    const aboutPay = analysis.unknowns.filter((item) => /what it pays/i.test(item.description))
    assert.equal(aboutPay.length, 1)
    assert.equal(aboutPay[0].id, 'unk_compensation')
  })
})

// ─── Interrupting has to be earned twice ──────────────────────────────────

describe('settleDecision', () => {
  it('lets an interruption through when both halves are cited', () => {
    const settled = settleDecision(
      analysisWith({ evidenceMatch: [groundedRequirement], intentMatch: [alignedAspect] }),
      proposal(),
    )
    assert.equal(settled.decision, 'INTERRUPT')
    assert.equal(settled.overrideReason, null)
    assert.equal(settled.modelDecision, 'INTERRUPT')
  })

  it('holds a match with nothing the candidate said they wanted', () => {
    const settled = settleDecision(
      analysisWith({ evidenceMatch: [groundedRequirement] }),
      proposal(),
    )
    assert.equal(settled.decision, 'HOLD')
    assert.match(settled.overrideReason ?? '', /intent profile/i)
  })

  it('holds a wish with nothing behind it', () => {
    const settled = settleDecision(analysisWith({ intentMatch: [alignedAspect] }), proposal())
    assert.equal(settled.decision, 'HOLD')
    assert.match(settled.overrideReason ?? '', /evidence/i)
  })

  it('holds when something in it runs against what they said', () => {
    const settled = settleDecision(
      analysisWith({
        evidenceMatch: [groundedRequirement],
        intentMatch: [
          alignedAspect,
          { ...alignedAspect, id: 'im_2', verdict: 'MISALIGNED', aspect: 'Agency work' },
        ],
      }),
      proposal(),
    )
    assert.equal(settled.decision, 'HOLD')
  })

  it('holds an otherwise good match with a material gap in it', () => {
    const gap: UnknownItem = {
      id: 'unk_compensation',
      side: 'opportunity',
      description: 'The posting does not state what it pays.',
      materiality: 'HIGH',
      resolvedBy: { type: 'ASK_COMPANY', question: 'What is the base salary range?' },
      deterministic: true,
    }
    const settled = settleDecision(
      analysisWith({
        evidenceMatch: [groundedRequirement],
        intentMatch: [alignedAspect],
        unknowns: [gap],
      }),
      proposal(),
    )
    assert.equal(settled.decision, 'HOLD')
    assert.ok(settled.materialUnknowns.includes('unk_compensation'))
    assert.equal(settled.nextBestAction.question, 'What is the base salary range?')
  })

  it('ignores anything that fails a hard constraint, whatever the model said', () => {
    const settled = settleDecision(
      analysisWith({
        hardConstraints: [
          {
            id: 'hc_salary',
            constraint: 'At least 120,000 EUR',
            verdict: 'FAIL',
            basis: 'The posting tops out at 70,000 EUR.',
            intentRefs: ['int_pref_salary_min'],
            evidenceIds: [],
            deterministic: true,
          },
        ],
        evidenceMatch: [groundedRequirement],
        intentMatch: [alignedAspect],
      }),
      proposal(),
    )
    assert.equal(settled.decision, 'IGNORE')
    assert.equal(settled.modelDecision, 'INTERRUPT')
    assert.match(settled.overrideReason ?? '', /Hard constraint failed/)
  })

  it('will not hold on nothing: a hold has to be waiting for something', () => {
    const settled = settleDecision(analysisWith(), proposal({ decision: 'HOLD' }))
    assert.equal(settled.decision, 'IGNORE')
  })

  it('drops a hold on a job the person has no evidence of being able to do', () => {
    // The case real offers produced: a backend role for a marketer, held
    // because it is remote, pays well and is the right stage. No answer from
    // the company turns that into a job they can do.
    const settled = settleDecision(
      analysisWith({
        evidenceMatch: [
          { ...groundedRequirement, verdict: 'NOT_SUPPORTED', evidenceIds: [], capabilityIds: [] },
        ],
        intentMatch: [alignedAspect],
      }),
      proposal({ decision: 'HOLD' }),
    )
    assert.equal(settled.decision, 'IGNORE')
    assert.match(settled.overrideReason ?? '', /materially asks for/)
  })

  it('keeps holding when the posting is the thing that said nothing', () => {
    // A thin posting states no requirements, so the evidence side was never
    // assessed. That is a gap the company can close, not a mismatch.
    const settled = settleDecision(
      analysisWith({
        intentMatch: [alignedAspect],
        unknowns: [
          {
            id: 'unk_compensation',
            side: 'opportunity',
            description: 'The posting does not state what it pays.',
            materiality: 'HIGH',
            resolvedBy: { type: 'ASK_COMPANY', question: 'What does it pay?' },
            deterministic: true,
          },
        ],
      }),
      proposal({ decision: 'HOLD' }),
    )
    assert.equal(settled.decision, 'HOLD')
  })

  it('keeps holding when something material is partly supported', () => {
    const settled = settleDecision(
      analysisWith({
        evidenceMatch: [{ ...groundedRequirement, verdict: 'PARTIALLY_SUPPORTED' }],
        intentMatch: [alignedAspect],
      }),
      proposal({ decision: 'HOLD' }),
    )
    assert.equal(settled.decision, 'HOLD')
  })

  it('will not drop something that is only missing information', () => {
    const settled = settleDecision(
      analysisWith({
        intentMatch: [alignedAspect],
        unknowns: [
          {
            id: 'unk_work_model',
            side: 'opportunity',
            description: 'The posting does not say whether this is remote.',
            materiality: 'HIGH',
            resolvedBy: { type: 'ASK_COMPANY', question: 'Is this role remote?' },
            deterministic: true,
          },
        ],
      }),
      proposal({ decision: 'IGNORE' }),
    )
    assert.equal(settled.decision, 'HOLD')
    assert.match(settled.overrideReason ?? '', /Not a mismatch, a gap/)
  })

  it('keeps only unknowns that were actually recorded', () => {
    const settled = settleDecision(
      analysisWith({ evidenceMatch: [groundedRequirement], intentMatch: [alignedAspect] }),
      proposal({ materialUnknowns: ['unk_invented'] }),
    )
    assert.deepEqual(settled.materialUnknowns, [])
  })
})

describe('what a gap is allowed to do', () => {
  const noticedByTheModel: UnknownItem = {
    id: 'unk_channel_mix',
    side: 'opportunity',
    description: 'The posting does not say how much of the roadmap is paid acquisition.',
    materiality: 'HIGH',
    resolvedBy: { type: 'ASK_COMPANY', question: 'What share of it is paid acquisition?' },
    deterministic: false,
  }
  const aboutThePerson: UnknownItem = {
    id: 'unk_dev_audience',
    side: 'candidate',
    description: 'We do not know whether he has grown a developer audience specifically.',
    materiality: 'HIGH',
    resolvedBy: { type: 'ASK_CANDIDATE', question: 'Have you grown a developer audience?' },
    deterministic: false,
  }

  it('lets an interruption through over gaps the model merely noticed', () => {
    const settled = settleDecision(
      analysisWith({
        evidenceMatch: [groundedRequirement],
        intentMatch: [alignedAspect],
        unknowns: [noticedByTheModel, aboutThePerson],
      }),
      proposal(),
    )
    // This is the fix for the first real run, where ten fixtures produced no
    // interruption at all: every posting is missing something material, and
    // one of the three gaps that bought silence was about him rather than
    // about the job.
    assert.equal(settled.decision, 'INTERRUPT')
    assert.equal(settled.overrideReason, null)
  })

  it('still stops on a gap in something they made a condition of', () => {
    const settled = settleDecision(
      analysisWith({
        evidenceMatch: [groundedRequirement],
        intentMatch: [alignedAspect],
        unknowns: [
          {
            id: 'unk_work_model',
            side: 'opportunity',
            description: 'The posting does not say whether this is remote, hybrid or on-site.',
            materiality: 'HIGH',
            resolvedBy: { type: 'ASK_COMPANY', question: 'Is this role remote?' },
            deterministic: true,
          },
        ],
      }),
      proposal(),
    )
    assert.equal(settled.decision, 'HOLD')
    assert.match(settled.overrideReason ?? '', /made a condition/)
  })

  it('separates the two, so what does not stop it can still be said', () => {
    const signals = decisionSignals(
      analysisWith({ unknowns: [noticedByTheModel, aboutThePerson] }),
    )
    assert.equal(signals.blockingUnknowns.length, 0)
    assert.deepEqual(
      signals.openQuestions.map((item) => item.id),
      ['unk_channel_mix', 'unk_dev_audience'],
    )
  })
})

describe('decisionSignals', () => {
  it('does not count a match on something that barely matters', () => {
    const signals = decisionSignals(
      analysisWith({
        evidenceMatch: [{ ...groundedRequirement, importance: 'LOW' }],
        intentMatch: [alignedAspect],
      }),
    )
    assert.equal(signals.groundedSupport.length, 0)
    assert.equal(signals.interruptReady, false)
    // Still something pointing the right way, which is what keeps it alive.
    assert.equal(signals.positiveSignal, true)
  })
})

describe('settleNextAction', () => {
  it('borrows the question from the unknown that caused the hold', () => {
    const analysis = analysisWith({
      unknowns: [
        {
          id: 'unk_equity',
          side: 'opportunity',
          description: 'Equity is not mentioned.',
          materiality: 'MEDIUM',
          resolvedBy: { type: 'ASK_COMPANY', question: 'Is there equity, and on what terms?' },
          deterministic: true,
        },
      ],
    })
    const action = settleNextAction('HOLD', analysis, ['unk_equity'], {
      type: 'NONE',
      question: null,
    })
    assert.equal(action.question, 'Is there equity, and on what terms?')
  })

  it('asks nothing when the answer is not a hold', () => {
    const action = settleNextAction('IGNORE', analysisWith(), [], {
      type: 'ASK_COMPANY',
      question: 'Anything?',
    })
    assert.deepEqual(action, { type: 'NONE', question: null })
  })
})

// ─── The explanation, audited ─────────────────────────────────────────────

describe('auditExplanation', () => {
  const explanation: Explanation = {
    headline: 'A growth role at a developer tools company.',
    whyShowing: { text: 'You said you were listening for AI infrastructure.', intentRefs: ['int_listening_1'] },
    whyYou: [
      { text: 'You have run growth for a developer tool before.', evidenceIds: ['ev_1'] },
      { text: 'You would be great at this.', evidenceIds: [] },
    ],
    whatToConsider: [
      { text: 'They have not said what it pays.', unknownIds: ['unk_compensation'] },
      { text: 'The team might be difficult.', unknownIds: ['unk_vibes'] },
    ],
  }

  it('drops what cannot be pointed at, and counts it', () => {
    const audited = auditExplanation(explanation, side, ['unk_compensation'])
    assert.equal(audited.explanation.whyYou.length, 1)
    assert.equal(audited.explanation.whatToConsider.length, 1)
    assert.equal(audited.unsupported.length, 2)
    assert.deepEqual(
      audited.unsupported.map((claim) => claim.where).sort(),
      ['whatToConsider', 'whyYou'],
    )
  })

  it('records a reason for showing something that rests on nothing they said', () => {
    const audited = auditExplanation(
      { ...explanation, whyShowing: { text: 'Felt right.', intentRefs: [] } },
      side,
      ['unk_compensation'],
    )
    assert.ok(audited.unsupported.some((claim) => claim.where === 'whyShowing'))
  })

  it('passes a fully grounded explanation through untouched', () => {
    const grounded: Explanation = {
      ...explanation,
      whyYou: [explanation.whyYou[0]],
      whatToConsider: [explanation.whatToConsider[0]],
    }
    const audited = auditExplanation(grounded, side, ['unk_compensation'])
    assert.equal(audited.unsupported.length, 0)
    assert.deepEqual(audited.explanation, grounded)
  })
})

// ─── What a no means ──────────────────────────────────────────────────────

describe('intentChangesFromResponse', () => {
  it('changes nothing about what they want, either way', () => {
    assert.equal(intentChangesFromResponse('NOT_FOR_ME'), null)
    assert.equal(intentChangesFromResponse('HEAR_THEM_OUT'), null)
  })
})
