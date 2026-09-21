/**
 * Una negociación entera, corriendo, con las dos partes dentro.
 *
 * Los tests del dominio prueban las reglas sueltas. Este prueba lo otro: que
 * al montarlas sobre datos de verdad —una evaluación con sus huecos, una
 * oferta con lo que la empresa sabe y no ha publicado— se siguen cumpliendo.
 * Que es donde se rompen las reglas: no al escribirlas, al usarlas.
 *
 * Lo que se comprueba es exactamente lo que decidiste el 19:
 *
 * - Que no se inventa preguntas: sale de los huecos que ya calculó el match.
 * - Que su nombre y su ciudad no salen mientras él no diga adelante.
 * - Que la empresa contesta lo que su oferta dice y **para** cuando no lo
 *   sabe, en vez de improvisar sobre su propio presupuesto.
 * - Que nadie declara el acuerdo.
 * - Y que a un humano sólo se le molesta cuando esto se atasca.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

type Negotiation = typeof import('./negotiation')
type NegotiationDb = typeof import('../db/negotiation')
type Opportunities = typeof import('../db/opportunities')
type Repo = typeof import('../db/repo')

let negotiation: Negotiation
let db: NegotiationDb
let opportunities: Opportunities
let repo: Repo
let candidateId: string
let workingDirectory: string
let previousDirectory: string

/** Lo que el Rep contestaría desde el grafo, y lo que intenta soltar. */
let repFacts: import('@/domains/negotiation/types').DisclosableFact[] = []

const answerFromGraph = async () => ({ text: 'Sí, y está respaldado.', facts: repFacts })

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-neg-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'

  negotiation = await import('./negotiation')
  db = await import('../db/negotiation')
  opportunities = await import('../db/opportunities')
  repo = await import('../db/repo')

  candidateId = repo.getOrCreateCandidate().id
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
  repFacts = [
    {
      kind: 'capability',
      text: 'Ha llevado una comunidad de desarrolladores.',
      evidenceIds: ['ev_community'],
    },
  ]
})

/**
 * Una oferta leída, con sus huecos: los mismos que produce el match de
 * verdad, con `side` y `resolvedBy` tal cual los escribe.
 */
function readOpportunity(unknowns: unknown[], hardFails = 0) {
  const opportunity = opportunities.insertOpportunity({
    candidate_id: candidateId,
    company: 'Solenne',
    role: 'Head of Growth',
    url: null,
    raw_text: 'Solenne busca Head of Growth.',
    provenance: 'test',
  })
  const rubric = opportunities.insertRubric({
    opportunity_id: opportunity.id,
    version: 'test',
    rubric: '{}',
    model_run_id: null,
    latency_ms: null,
  })
  opportunities.insertAssessment({
    opportunity_id: opportunity.id,
    rubric_id: rubric.id,
    version: 'test',
    hard_constraints: JSON.stringify(
      Array.from({ length: hardFails }, () => ({ verdict: 'FAIL' })),
    ),
    evidence_match: '[]',
    intent_match: '[]',
    unknowns: JSON.stringify(unknowns),
    intent_references: '[]',
    model_run_id: null,
    latency_ms: null,
  })
  return opportunity.id
}

const gap = (
  id: string,
  side: 'candidate' | 'opportunity',
  question: string,
  type: 'ASK_CANDIDATE' | 'ASK_COMPANY' = side === 'candidate' ? 'ASK_CANDIDATE' : 'ASK_COMPANY',
) => ({
  id,
  side,
  description: question,
  materiality: 'HIGH',
  resolvedBy: { type, question },
  deterministic: false,
})

function opening(answers: Record<string, string>) {
  return db.insertOpening({
    employer: 'Solenne',
    role: 'Head of Growth',
    posting_text: 'Buscamos Head of Growth.',
    answers,
  })
}

describe('una negociación entera', () => {
  it('no se inventa preguntas: salen de los huecos que ya calculó el match', async () => {
    const opportunityId = readOpportunity([
      gap('unc_community', 'candidate', '¿Has llevado una comunidad de desarrolladores?'),
      gap('unc_equity', 'opportunity', '¿Hay equity, y en qué condiciones?'),
    ])
    const open = opening({ equity: '0,5% a cuatro años.' })
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    await negotiation.runNegotiation(neg.id, answerFromGraph)
    const turns = db.listTurns(neg.id)
    const asked = turns.filter((turn) => turn.kind === 'question').map((turn) => turn.text)

    assert.deepEqual(asked, [
      '¿Has llevado una comunidad de desarrolladores?',
      '¿Hay equity, y en qué condiciones?',
    ])
    // Y la de la empresa primero: es la que decide si esto sigue.
    assert.equal(turns[0].side, 'employer')
  })

  it('su nombre y su ciudad no salen mientras él no diga adelante', async () => {
    repFacts = [
      { kind: 'identity', text: 'Borja, en Valencia', evidenceIds: ['ev_cv'] },
      { kind: 'capability', text: 'Llevó una comunidad.', evidenceIds: ['ev_community'] },
      { kind: 'figure', text: 'lo supera', value: 120_000, evidenceIds: ['ev_pref'] },
    ]
    const opportunityId = readOpportunity([
      gap('unc_who', 'candidate', '¿Quién es y qué ha hecho?'),
    ])
    const open = opening({})
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    await negotiation.runNegotiation(neg.id, answerFromGraph)
    const answer = db.listTurns(neg.id).find((turn) => turn.side === 'rep' && turn.kind === 'answer')
    const released = JSON.parse(String(answer?.facts)) as { kind: string; value?: number }[]

    assert.ok(!released.some((fact) => fact.kind === 'identity'), 'la identidad no sale')
    assert.ok(released.some((fact) => fact.kind === 'capability'), 'lo que sí puede, sale')
    // Y la cifra se queda dentro: sale «lo supera», nunca 120.000.
    const figure = released.find((fact) => fact.kind === 'figure')
    assert.equal(figure?.value, undefined)
    // Lo retenido queda escrito, para poder contestar a «¿qué dijiste de mí?».
    assert.match(String(answer?.withheld), /no name, no employer, no city/)
  })

  it('la empresa contesta lo que su oferta dice', async () => {
    const opportunityId = readOpportunity([
      gap('unc_equity', 'opportunity', '¿Hay equity, y en qué condiciones?'),
    ])
    const open = opening({ equity: '0,5% a cuatro años, con un año de cliff.' })
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    const step = await negotiation.runNegotiation(neg.id, answerFromGraph)

    assert.match(String(step.answered ?? ''), /0,5%/)
    assert.equal(step.needsHuman, null)
  })

  it('y para cuando no lo sabe, en vez de inventárselo', async () => {
    // Una empresa que improvisa sobre su propio presupuesto es peor que una
    // que calla: quien pregunta toma una decisión sobre su vida con eso.
    const opportunityId = readOpportunity([
      gap('unc_budget', 'opportunity', '¿Cuál es el techo real del presupuesto?'),
    ])
    const open = opening({ equity: 'Hay equity.' })
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    const step = await negotiation.runNegotiation(neg.id, answerFromGraph)

    assert.equal(step.state, 'stalled')
    assert.equal(step.needsHuman?.who, 'employer')
    assert.match(String(step.needsHuman?.question), /presupuesto/)
  })

  it('nadie declara el acuerdo: no hay un turno para eso', async () => {
    const opportunityId = readOpportunity([
      gap('unc_equity', 'opportunity', '¿Hay equity, y en qué condiciones?'),
    ])
    const open = opening({ equity: '0,5%.' })
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    const step = await negotiation.runNegotiation(neg.id, answerFromGraph)

    // Lo escribe el código mirando las dos partes, no un agente convencido.
    assert.equal(step.state, 'agreed')
    assert.ok(db.listTurns(neg.id).every((turn) => turn.kind === 'question' || turn.kind === 'answer'))
  })

  it('un hard constraint que falla la mata en vez de seguir preguntando', async () => {
    const opportunityId = readOpportunity(
      [gap('unc_equity', 'opportunity', '¿Hay equity?')],
      1,
    )
    const open = opening({ equity: '0,5%.' })
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    const step = await negotiation.runNegotiation(neg.id, answerFromGraph)
    assert.equal(step.state, 'dead')
  })

  it('no vuelve a preguntar lo ya preguntado, aunque se corte y se retome', async () => {
    const opportunityId = readOpportunity([
      gap('unc_one', 'candidate', '¿Una?'),
      gap('unc_two', 'candidate', '¿Dos?'),
    ])
    const open = opening({})
    const neg = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    await negotiation.stepNegotiation(neg.id, answerFromGraph)
    await negotiation.stepNegotiation(neg.id, answerFromGraph)
    await negotiation.stepNegotiation(neg.id, answerFromGraph)

    const asked = db
      .listTurns(neg.id)
      .filter((turn) => turn.kind === 'question')
      .map((turn) => turn.text)
    assert.deepEqual(asked, ['¿Una?', '¿Dos?'])
  })

  it('una por par, y sólo una', () => {
    // Dos conversaciones sobre la misma oferta serían dos versiones de lo que
    // se dijo, y «¿qué contaste de mí?» dejaría de tener una respuesta.
    const opportunityId = readOpportunity([])
    const open = opening({})
    const first = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })
    const again = db.openNegotiation({
      candidate_id: candidateId,
      opening_id: open.id,
      opportunity_id: opportunityId,
    })

    assert.equal(again.id, first.id)
  })
})
