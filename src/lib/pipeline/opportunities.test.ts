/**
 * The pipeline, run end to end against a throwaway database and stubbed
 * model calls.
 *
 * Two things are being checked that the pure rules cannot check on their
 * own. The first is the promise the whole experiment rests on: the label
 * the person wrote before Amble ran never reaches the model. That is not
 * asserted here, it is looked for — the label carries a token that appears
 * nowhere else, and every prompt the pipeline would send is searched for it.
 *
 * The second is that the stages are resumable. A phone loses signal mid-run
 * and the job comes back; if that made it pay for the rubric again, the
 * queue would be a worse place to do this work than a request.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Pipeline = typeof import('./opportunities')
type Repo = typeof import('../db/repo')
type Preferences = typeof import('./preferences')

/** Appears in the blind label and absolutely nowhere else. */
const CANARY = 'zzqq-blind-label-canary-zzqq'

let pipeline: Pipeline
let repo: Repo
let preferences: Preferences
let candidateId: string
let evidenceIds: string[] = []
let workingDirectory: string
let previousDirectory: string

/** How many times each stage actually called a model. */
const calls = { rubric: 0, match: 0, decision: 0, explanation: 0 }

const OPPORTUNITY_TEXT = `Aurora Labs is looking for a Head of Growth to take our developer
platform from its first thousand users to its first ten thousand. Fully remote across the EU,
€130,000 - €150,000 plus 0.5% - 1% equity. Series A, eleven people, AI infrastructure.`

before(async () => {
  // The database lives under the working directory, so the test gets one of
  // its own rather than writing into whatever is in .amble-data.
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-test-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'

  pipeline = await import('./opportunities')
  repo = await import('../db/repo')
  preferences = await import('./preferences')

  candidateId = repo.getOrCreateCandidate().id

  const evidence = [
    'Ran growth for a developer tools company from 1,000 to 40,000 signups over three years.',
    'Wrote and shipped the technical content programme that produced most of that growth.',
  ].map((statement, index) =>
    repo.insertEvidence({
      id: `ev_test_${index + 1}`,
      candidate_id: candidateId,
      claim_id: null,
      statement,
      epistemic_state: 'ESTABLISHED',
      source_type: 'cv',
      source_id: null,
      source_excerpt: null,
      strength: 'strong',
      confidence: 0.9,
      candidate_confirmed: 1,
      human_verified: 0,
      interview_turn_id: null,
    }),
  )
  evidenceIds = evidence.map((item) => item.id)

  repo.upsertCapability(
    candidateId,
    'cap_growth',
    'Developer-tools growth',
    'STRONG',
    'Took a developer platform from a thousand users to forty thousand.',
  )
  repo.linkCapabilityEvidence(candidateId, 'cap_growth', evidenceIds)

  repo.insertIntent({
    id: repo.newId('intent'),
    candidate_id: candidateId,
    raw_answer: 'Growth leadership at an early-stage AI infrastructure company, remote.',
    groups: JSON.stringify([{ label: 'Roles', values: ['Head of Growth'] }]),
    listening_for: JSON.stringify(['AI infrastructure']),
  })

  preferences.writePreferences(candidateId, {
    salaryMin: 120_000,
    salaryCurrency: 'EUR',
    workMode: 'remote',
    location: 'Valencia',
    technologies: ['AI infrastructure'],
    stages: ['Seed', 'Series A'],
  })
})

after(() => {
  process.chdir(previousDirectory)
  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open a moment longer than we care about.
  }
})

// ─── The stubs ────────────────────────────────────────────────────────────

/**
 * A model that answers well: a clean rubric, a grounded reading, and an
 * interruption it can point at. What the rules do with a good proposal is
 * as much a test as what they do with a bad one.
 */
function runners(rubricOverrides: Record<string, unknown> = {}) {
  return {
    rubric: async () => {
      calls.rubric += 1
      return {
        data: {
          roleScope: 'Growth leadership for a developer platform',
          seniority: 'Head of',
          companyStage: 'Series A',
          industry: 'AI infrastructure',
          location: 'Remote (EU)',
          workModel: 'remote' as const,
          compensation: { min: 130_000, max: 150_000, currency: 'EUR', stated: null },
          equity: '0.5% - 1%',
          environment: ['eleven people'],
          requirements: [
            {
              id: 'req_1',
              text: 'Has grown a developer platform',
              kind: 'capability' as const,
              importance: 'REQUIRED' as const,
            },
          ],
          preferences: [],
          unknowns: [],
          ...rubricOverrides,
        },
        modelRunId: 'run_rubric',
        latencyMs: 10,
      }
    },
    match: async () => {
      calls.match += 1
      return {
        data: {
          hardConstraints: [],
          evidenceMatch: [
            {
              requirementId: 'req_1',
              requirement: 'Has grown a developer platform',
              importance: 'REQUIRED' as const,
              verdict: 'SUPPORTED' as const,
              evidenceIds,
              capabilityIds: ['cap_growth'],
              note: 'Did exactly this for three years.',
            },
          ],
          intentMatch: [
            {
              id: 'im_1',
              aspect: 'Space',
              verdict: 'ALIGNED' as const,
              intentRefs: ['int_listening_1'],
              note: 'They said AI infrastructure.',
            },
          ],
          unknowns: [],
        },
        modelRunId: 'run_match',
        latencyMs: 10,
      }
    },
    decision: async () => {
      calls.decision += 1
      return {
        data: {
          decision: 'INTERRUPT' as const,
          reason: 'It is the job they described, at a company doing what they are listening for.',
          supportingEvidenceIds: evidenceIds,
          supportingIntentReferences: ['int_listening_1'],
          materialUnknowns: [],
          nextBestAction: { type: 'NONE' as const, question: null },
        },
        modelRunId: 'run_decision',
        latencyMs: 10,
      }
    },
    explanation: async () => {
      calls.explanation += 1
      return {
        data: {
          headline: 'Growth lead at an AI infrastructure company, remote, above your floor.',
          whyShowing: {
            text: 'You asked me to listen for AI infrastructure.',
            intentRefs: ['int_listening_1'],
          },
          whyYou: [
            { text: 'You have taken a developer platform from a thousand users to forty thousand.', evidenceIds: [evidenceIds[0]] },
            { text: 'You would fit in well there.', evidenceIds: [] },
          ],
          whatToConsider: [
            { text: 'They have not said who you would report to.', unknownIds: ['unk_invented'] },
          ],
        },
        modelRunId: 'run_explanation',
        latencyMs: 10,
      }
    },
  } as unknown as Parameters<Pipeline['evaluateOpportunity']>[1]
}

function ingest(company: string, fixtureKey: string) {
  return pipeline.ingestOpportunity({
    candidateId,
    company,
    role: 'Head of Growth',
    rawText: OPPORTUNITY_TEXT,
    provenance: 'manual',
    fixtureKey,
    label: { label: 'YES', comment: `written before anything ran ${CANARY}` },
  })
}

// ─── The promise the experiment rests on ──────────────────────────────────

describe('the blind label', () => {
  it('is stored, and is not in any prompt the pipeline would send', async () => {
    const opportunity = ingest('Aurora Labs', 'test-blind')

    const before = pipeline.stagePromptsFor(opportunity.id)
    assert.ok(before?.rubric, 'the rubric prompt is buildable before anything runs')

    await pipeline.evaluateOpportunity(opportunity.id, runners())

    const prompts = pipeline.stagePromptsFor(opportunity.id)
    assert.ok(prompts)
    // All four, so this is checking the whole surface rather than one stage.
    assert.deepEqual(Object.keys(prompts).sort(), [
      'decision',
      'explanation',
      'match',
      'rubric',
    ])
    for (const [stage, prompt] of Object.entries(prompts)) {
      assert.ok(
        !`${prompt.system}\n${prompt.user}`.includes(CANARY),
        `the ${stage} prompt carries the blind label`,
      )
    }

    // And it is still there to compare against afterwards.
    const label = pipeline.blindLabelFor(opportunity.id)
    assert.equal(label?.label, 'YES')
    assert.ok(label?.comment?.includes(CANARY))
  })
})

// ─── What comes out the other end ─────────────────────────────────────────

describe('evaluateOpportunity', () => {
  it('lets a grounded interruption through and drops what it cannot point at', async () => {
    const opportunity = ingest('Northwind Systems', 'test-interrupt')
    const result = await pipeline.evaluateOpportunity(opportunity.id, runners())

    assert.equal(result.decision, 'INTERRUPT')
    assert.equal(result.modelDecision, 'INTERRUPT')
    assert.equal(result.overrideReason, null)
    // Two of them: a claim about the person with no evidence, and something
    // to consider that is not one of the recorded unknowns.
    assert.equal(result.unsupportedClaims, 2)
    assert.deepEqual(result.ran, ['rubric', 'match', 'decision', 'explanation'])
  })

  it('does not pay for a stage it has already paid for', async () => {
    const opportunity = ingest('Halden', 'test-resume')
    await pipeline.evaluateOpportunity(opportunity.id, runners())
    const before = { ...calls }

    const again = await pipeline.evaluateOpportunity(opportunity.id, runners())
    assert.deepEqual(again.ran, [], 'a second run should have nothing left to do')
    assert.deepEqual(calls, before, 'and should not have called the model again')
    assert.equal(again.decision, 'INTERRUPT')
  })

  it('drops what fails a hard constraint without paying to explain it', async () => {
    const opportunity = ingest('Underpay Inc', 'test-hard-fail')
    const before = calls.explanation
    const result = await pipeline.evaluateOpportunity(
      opportunity.id,
      // Everything else identical: the model still proposes an interruption,
      // and it is the floor the candidate named that settles it.
      runners({ compensation: { min: 60_000, max: 70_000, currency: 'EUR', stated: null } }),
    )

    assert.equal(result.decision, 'IGNORE')
    assert.equal(result.modelDecision, 'INTERRUPT')
    assert.match(result.overrideReason ?? '', /Hard constraint failed/)
    assert.ok(!result.ran.includes('explanation'), 'an ignored opportunity is not explained')
    assert.equal(calls.explanation, before)
  })

  it('writes an audit trail of what happened, in order', async () => {
    const opportunity = ingest('Cormorant', 'test-audit')
    await pipeline.evaluateOpportunity(opportunity.id, runners())

    const { listAuditEvents } = await import('../db/opportunities')
    const events = listAuditEvents('opportunity', opportunity.id).map((event) => event.event)
    assert.deepEqual(events, [
      'opportunity_received',
      'rubric_extracted',
      'match_assessed',
      'decision_proposed',
      'decision_settled',
      'explanation_written',
      'decision_recorded',
    ])
  })
})

// ─── What reaches the candidate, and what does not ────────────────────────

describe('getPendingInterruption', () => {
  it('hands the listening screen the evidence itself, not our filing system', async () => {
    const opportunity = ingest('Halvard', 'test-pending')
    await pipeline.evaluateOpportunity(opportunity.id, runners())

    const view = await import('../opportunity-view')
    const pending = view.getPendingInterruption()
    assert.ok(pending, 'an interruption was decided, so there is one to show')
    assert.equal(pending.company, 'Halvard')
    assert.ok(pending.headline.length > 0)
    // Statements, not ids: everything said about someone on that screen is
    // checkable by them without a lookup.
    assert.deepEqual(pending.whyYou[0].evidence, [
      'Ran growth for a developer tools company from 1,000 to 40,000 signups over three years.',
    ])
    // And what came out of the rubric, only where the posting said it.
    assert.ok(pending.facts.some((fact) => fact.label === 'Pays'))
    assert.ok(pending.facts.some((fact) => fact.label === 'Work' && fact.value === 'Remote'))

    pipeline.recordCandidateResponse(opportunity.id, 'NOT_FOR_ME')
    assert.notEqual(
      view.getPendingInterruption()?.opportunityId,
      opportunity.id,
      'an answered interruption does not come back',
    )
  })
})

// ─── What the candidate's answer does, and does not do ────────────────────

describe('recordCandidateResponse', () => {
  it('records a no and leaves the intent profile exactly where it was', async () => {
    const opportunity = ingest('Tessellate', 'test-response')
    await pipeline.evaluateOpportunity(opportunity.id, runners())

    const intentBefore = repo.getLatestIntent(candidateId)
    const preferencesBefore = preferences.readPreferences(candidateId)

    const result = pipeline.recordCandidateResponse(opportunity.id, 'NOT_FOR_ME')
    assert.deepEqual(result, { ok: true })

    assert.deepEqual(repo.getLatestIntent(candidateId), intentBefore)
    assert.deepEqual(preferences.readPreferences(candidateId), preferencesBefore)
  })

  it('has nothing to answer when nothing was shown', async () => {
    const opportunity = ingest('Quiet Co', 'test-no-decision')
    const result = pipeline.recordCandidateResponse(opportunity.id, 'HEAR_THEM_OUT')
    assert.equal(result.ok, false)
  })
})
