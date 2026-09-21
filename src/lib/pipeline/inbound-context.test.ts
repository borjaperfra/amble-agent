/**
 * Lo que cuenta sin que nadie le pregunte, contra una base de usar y tirar y
 * un modelo de mentira.
 *
 * Tres cosas que no se ven mirando el código. Que lo que escribe sin tener
 * nada abierto acaba en el grafo con el mensaje como procedencia —si no, el
 * Rep sigue siendo un formulario—. Que no acaba dos veces, que es el bug que
 * ya pasó una vez con las respuestas a preguntas y dejó dos evidencias por
 * cada frase dicha una sola vez. Y que volver a decidir lo que está en
 * espera cuesta llamadas, así que solo pasa cuando lo que contó movió algo:
 * un «gracias» no puede disparar quince evaluaciones.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

type Context = typeof import('./inbound-context')
type Opportunities = typeof import('../db/opportunities')
type Repo = typeof import('../db/repo')
type InboundDb = typeof import('../db/inbound')

let context: Context
let opportunities: Opportunities
let repo: Repo
let inboundDb: InboundDb
let candidateId: string
let workingDirectory: string
let previousDirectory: string

/** Qué tarea pidió cada llamada, en orden. */
let asked: string[] = []
/** Si la reevaluación dice que algo se movió, o que no. */
let reassessMoves = false

const extraction = {
  claims: [
    {
      statement: 'He ran a developer community of 120,000 people.',
      claimType: 'experience',
      epistemicState: 'USER_CLAIM',
      sourceExcerpt: 'la comunidad de Manfred',
      confidence: 0.8,
      requiresConfirmation: false,
      possibleCapabilities: ['cap_growth'],
    },
  ],
}

/** Una reevaluación que no cambia nada: ni capacidades ni incertidumbres. */
const unmoved = { assessments: [], uncertaintyUpdates: [], newUncertainties: [] }

/** Una que sí: la capacidad sube de nota con la evidencia nueva. */
const moved = {
  assessments: [
    {
      slug: 'cap_growth',
      name: 'Developer-tools growth',
      assessment: 'STRONG',
      reason: 'The community is the part that was missing.',
      evidenceIds: ['ev_seed'],
    },
  ],
  uncertaintyUpdates: [],
  newUncertainties: [],
}

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-context-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'
  process.env.AMBLE_MODEL_API_KEY = 'test-key'
  process.env.AMBLE_MODEL_ID = 'test-model'

  context = await import('./inbound-context')
  opportunities = await import('../db/opportunities')
  repo = await import('../db/repo')
  inboundDb = await import('../db/inbound')

  candidateId = repo.getOrCreateCandidate().id

  const evidence = repo.insertEvidence({
    id: 'ev_seed',
    candidate_id: candidateId,
    claim_id: null,
    statement: 'Ran growth for a developer tools company.',
    epistemic_state: 'ESTABLISHED',
    source_type: 'cv',
    source_id: null,
    source_excerpt: null,
    strength: 'strong',
    confidence: 0.9,
    candidate_confirmed: 1,
    human_verified: 0,
    interview_turn_id: null,
  })
  repo.upsertCapability(candidateId, 'cap_growth', 'Developer-tools growth', 'GOOD', 'From the CV.')
  repo.linkCapabilityEvidence(candidateId, 'cap_growth', [evidence.id])

  heldOpportunity()

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages: { role: string; content: string }[]
    }
    const system = body.messages.find((message) => message.role === 'system')?.content ?? ''
    const unprompted = system.includes('unprompted extraction engine')
    asked.push(unprompted ? 'extract' : 'reassess')
    const content = unprompted
      ? JSON.stringify(extraction)
      : JSON.stringify(reassessMoves ? moved : unmoved)

    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch
})

after(() => {
  process.chdir(previousDirectory)
  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open a moment longer than we care about.
  }
})

beforeEach(() => {
  asked = []
})

/** Una oferta cuya última decisión es HOLD, que es lo único reevaluable. */
function heldOpportunity(): string {
  const opportunity = opportunities.insertOpportunity({
    candidate_id: candidateId,
    company: 'Solenne',
    role: 'Head of Growth',
    url: null,
    raw_text: 'Solenne is looking for a Head of Growth.',
    provenance: 'test',
  })
  const rubric = opportunities.insertRubric({
    opportunity_id: opportunity.id,
    version: 'test',
    rubric: '{}',
    model_run_id: null,
    latency_ms: null,
  })
  const assessment = opportunities.insertAssessment({
    opportunity_id: opportunity.id,
    rubric_id: rubric.id,
    version: 'test',
    hard_constraints: '[]',
    evidence_match: '[]',
    intent_match: '[]',
    unknowns: '[]',
    intent_references: '[]',
    model_run_id: null,
    latency_ms: null,
  })
  opportunities.insertDecision({
    opportunity_id: opportunity.id,
    assessment_id: assessment.id,
    version: 'test',
    model_decision: 'HOLD',
    decision: 'HOLD',
    override_reason: null,
    reason: 'Whether he has run a community is not settled.',
    supporting_evidence_ids: '[]',
    supporting_intent_refs: '[]',
    material_unknowns: '[]',
    next_action_type: 'ASK_CANDIDATE',
    next_action_question: null,
    explanation: null,
    unsupported_claims: '[]',
    model_run_id: null,
    explanation_model_run_id: null,
    latency_ms: null,
  })
  return opportunity.id
}

let nextExternalId = 100

function arrive(text: string): string {
  nextExternalId += 1
  return inboundDb.claimInboundMessage({
    candidate_id: candidateId,
    channel: 'telegram',
    external_id: String(nextExternalId),
    chat_id: '4242',
    sender: 'Borja',
    text,
    outcome: 'noted_as_context',
  }).message.id
}

function reassessedHolds(messageId: string): number {
  const audit = opportunities
    .listAuditEvents('inbound', messageId)
    .find((event) => event.event === 'unprompted_context_incorporated')
  return JSON.parse(String(audit?.detail)).reassessedHolds as number
}

function claimsFrom(messageId: string) {
  return repo.listClaims(candidateId).filter((claim) => claim.interview_turn_id === messageId)
}

describe('something they told their Rep with nothing open', () => {
  it('lands in the graph, with the message itself as where it came from', async () => {
    reassessMoves = false
    const messageId = arrive('Por cierto, llevé la comunidad de Manfred, 120k devs.')

    await context.incorporateUnpromptedJob(candidateId, messageId)

    const claims = claimsFrom(messageId)
    assert.equal(claims.length, 1, 'the claim points at the message, not at an interview turn')
    assert.match(claims[0].statement, /community/)
    assert.ok(inboundDb.getInboundMessage(messageId)?.incorporated_at)
  })

  it('is not read into the graph a second time', async () => {
    reassessMoves = false
    const messageId = arrive('Monté la comunidad de Manfred.')

    await context.incorporateUnpromptedJob(candidateId, messageId)
    const first = asked.length
    await context.incorporateUnpromptedJob(candidateId, messageId)

    assert.equal(asked.length, first, 'the second pass costs nothing and extracts nothing')
    assert.equal(claimsFrom(messageId).length, 1)
  })

  it('leaves what is on hold alone when nothing it said moved anything', async () => {
    reassessMoves = false
    const messageId = arrive('Gracias!')

    await context.incorporateUnpromptedJob(candidateId, messageId)

    assert.equal(reassessedHolds(messageId), 0)
  })

  it('sends what is on hold back for a decision when it did', async () => {
    reassessMoves = true
    const messageId = arrive('Llevé la comunidad de Manfred, 120k devs, tres años.')

    await context.incorporateUnpromptedJob(candidateId, messageId)

    assert.equal(reassessedHolds(messageId), 1)
  })
})
