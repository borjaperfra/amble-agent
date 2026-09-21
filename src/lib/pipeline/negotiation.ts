/**
 * Los dos agentes, turnándose.
 *
 * Y lo primero que hay que decir es lo que **no** hace: no inventa preguntas.
 * Las preguntas ya existían. Cada evaluación produce `unknowns` con su lado y
 * su pregunta —`ASK_CANDIDATE` son las de la empresa para el Rep,
 * `ASK_COMPANY` las del Rep para la empresa— y llevaban ahí desde el primer
 * día sin que nadie las usara para nada más que un mensaje suelto.
 *
 * Eso es lo que hace esto barato y honesto a la vez: la conversación no es un
 * modelo improvisando, es dos listas de huecos que se van cerrando. Las
 * preguntas salen de los huecos que identificaron las reglas — literalmente
 * lo que decía la nota del 19.
 *
 * Y la asimetría entre los dos lados es deliberada:
 *
 * - **La empresa contesta sólo lo que su oferta dice.** Si no lo dice, no lo
 *   sabe, y eso **para la conversación y llama a un humano**. Sin modelo: una
 *   empresa que improvisa sobre su propio presupuesto es peor que una que
 *   calla.
 * - **El Rep contesta desde el grafo**, con evidencia detrás, y lo que sale
 *   pasa por la escalera antes de salir. Ahí sí hay modelo, porque «¿ha
 *   llevado una comunidad?» no se contesta con un campo.
 *
 * Nadie declara nada. El estado lo calcula `negotiationState` mirando las
 * señales de las dos partes, que es la decisión 3.
 */

import {
  appendTurn,
  askedUnknownIds,
  getNegotiation,
  getOpening,
  listTurns,
  setNegotiationState,
  type NegotiationRow,
  type OpeningRow,
} from '../db/negotiation'
import { getLatestAssessment, getOpportunity } from '../db/opportunities'
import { humanNeeded, negotiationState, redact } from '@/domains/negotiation/rules'
import type { DisclosableFact, NegotiationTurn, Side } from '@/domains/negotiation/types'
import type { UnknownItem } from '@/domains/opportunity/types'

/** Cuántos turnos antes de parar. Una conversación de veinte es un bucle. */
export const MAX_TURNS = 12

export interface AnswerFromGraph {
  (question: string, candidateId: string): Promise<{ text: string; facts: DisclosableFact[] }>
}

interface Analysis {
  unknowns: UnknownItem[]
  hardFails: number
  blockingUnknowns: number
}

function analysisFor(opportunityId: string): Analysis | null {
  const assessment = getLatestAssessment(opportunityId)
  if (!assessment) return null
  try {
    const unknowns = JSON.parse(assessment.unknowns) as UnknownItem[]
    const hard = JSON.parse(assessment.hard_constraints) as { verdict: string }[]
    return {
      unknowns,
      hardFails: hard.filter((check) => check.verdict === 'FAIL').length,
      blockingUnknowns: unknowns.filter(
        (item) => item.materiality === 'HIGH' && item.deterministic,
      ).length,
    }
  } catch {
    return null
  }
}

/**
 * Lo que la empresa sabe de su propia oferta.
 *
 * Un diccionario, no un modelo. Lo que no esté escrito, su agente no lo sabe
 * — y decirlo es mejor producto que adivinarlo: quien pregunta por el
 * presupuesto y recibe un número inventado toma una decisión sobre su vida
 * con él.
 */
function employerAnswer(opening: OpeningRow, question: string): string | null {
  let answers: Record<string, string>
  try {
    answers = JSON.parse(opening.answers) as Record<string, string>
  } catch {
    return null
  }

  // Por palabras clave y no por la pregunta literal: la escribe un modelo
  // leyendo un anuncio, así que nunca sale dos veces igual.
  const asked = question.toLowerCase()
  for (const [key, value] of Object.entries(answers)) {
    if (asked.includes(key.toLowerCase())) return value
  }
  return null
}

/** El turno que toca, o nada si no queda nada que preguntar. */
function nextQuestion(
  analysis: Analysis,
  asked: ReadonlySet<string>,
): { side: Side; unknown: UnknownItem } | null {
  // Primero lo que la empresa necesita saber de él: es lo que decide si esto
  // sigue, y preguntarle a la empresa por su equity mientras no se sabe si
  // encaja es gastar turnos en la parte fácil.
  const forRep = analysis.unknowns.find(
    (item) => item.side === 'candidate' && !asked.has(item.id) && item.resolvedBy.question,
  )
  if (forRep) return { side: 'employer', unknown: forRep }

  const forEmployer = analysis.unknowns.find(
    (item) =>
      item.side === 'opportunity' &&
      item.resolvedBy.type === 'ASK_COMPANY' &&
      !asked.has(item.id) &&
      item.resolvedBy.question,
  )
  if (forEmployer) return { side: 'rep', unknown: forEmployer }

  return null
}

export interface NegotiationStep {
  /** Qué pasó en esta vuelta, para poder contarlo. */
  asked: string | null
  answered: string | null
  state: NegotiationRow['state']
  needsHuman: { who: Side; question: string } | null
}

/**
 * Una vuelta: uno pregunta, el otro contesta, y se recalcula el estado.
 *
 * Reanudable como todo lo demás: lo que se dijo está en la tabla, así que un
 * corte a mitad no repite lo preguntado ni pierde lo contestado.
 */
export async function stepNegotiation(
  negotiationId: string,
  answerFromGraph: AnswerFromGraph,
): Promise<NegotiationStep> {
  const negotiation = getNegotiation(negotiationId)
  if (!negotiation) throw new Error(`Negotiation ${negotiationId} is gone.`)

  const opening = getOpening(negotiation.opening_id)
  const opportunity = getOpportunity(negotiation.opportunity_id)
  if (!opening || !opportunity) throw new Error('Negotiation points at something that is gone.')

  const analysis = analysisFor(negotiation.opportunity_id)
  if (!analysis) throw new Error('That opportunity has not been read yet.')

  const turns = listTurns(negotiationId)
  const asTurns: NegotiationTurn[] = turns.map((turn) => ({
    side: turn.side,
    kind: turn.kind,
    text: turn.text,
    facts: JSON.parse(turn.facts) as DisclosableFact[],
    needsHuman: turn.needs_human
      ? (JSON.parse(turn.needs_human) as { who: Side; question: string })
      : undefined,
  }))

  // Las dos partes, cada una con sus propias cuentas. Hoy las del Rep salen
  // del análisis y las de la empresa de sus condiciones — el día que haya dos
  // despliegues, cada uno calculará las suyas y sólo cruzarán estos números.
  const ours = { hardFails: analysis.hardFails, blockingUnknowns: analysis.blockingUnknowns }
  const theirs = { hardFails: 0, blockingUnknowns: 0 }

  const settle = (): NegotiationStep => {
    const state = negotiationState(ours, theirs, asTurns, false)
    setNegotiationState(negotiationId, state)
    return {
      asked: null,
      answered: null,
      state,
      needsHuman: humanNeeded(state, asTurns),
    }
  }

  if (turns.length >= MAX_TURNS) return settle()

  const next = nextQuestion(analysis, askedUnknownIds(negotiationId))
  if (!next) return settle()

  const question = next.unknown.resolvedBy.question as string
  appendTurn({
    negotiation_id: negotiationId,
    side: next.side,
    kind: 'question',
    text: question,
    unknown_id: next.unknown.id,
  })

  // ── Y la otra parte contesta, cada una con lo suyo ─────────────────────
  if (next.side === 'employer') {
    // Se lo preguntan al Rep: sale del grafo, y pasa por la escalera.
    const { text, facts } = await answerFromGraph(question, negotiation.candidate_id)
    const { released, withheld } = redact(facts, negotiation.disclosure_tier)

    appendTurn({
      negotiation_id: negotiationId,
      side: 'rep',
      kind: 'answer',
      text,
      facts: released,
      withheld,
      unknown_id: next.unknown.id,
    })
    asTurns.push({ side: 'rep', kind: 'answer', text, facts: released })
  } else {
    // Se lo preguntan a la empresa: o lo dice su oferta, o no lo sabe.
    const known = employerAnswer(opening, question)
    const needsHuman = known ? null : { who: 'employer' as const, question }

    appendTurn({
      negotiation_id: negotiationId,
      side: 'employer',
      kind: 'answer',
      text: known ?? 'No lo sé por la oferta.',
      needs_human: needsHuman,
      unknown_id: next.unknown.id,
    })
    asTurns.push({
      side: 'employer',
      kind: 'answer',
      text: known ?? 'No lo sé por la oferta.',
      facts: [],
      needsHuman: needsHuman ?? undefined,
    })
  }

  // Quedan preguntas si, después de este turno, todavía hay un hueco sin
  // tocar. Sin esto se acuerda en el vacío: nadie tiene nada en contra
  // porque nadie ha preguntado nada.
  const more = nextQuestion(analysis, askedUnknownIds(negotiationId)) !== null
  const state = negotiationState(ours, theirs, asTurns, more)
  setNegotiationState(negotiationId, state)

  return {
    asked: question,
    answered: asTurns[asTurns.length - 1]?.text ?? null,
    state,
    needsHuman: humanNeeded(state, asTurns),
  }
}

/**
 * Hasta que se acuerde, se muera, se atasque o se acaben los turnos.
 *
 * Nunca «hasta que uno convenza al otro»: eso es lo que hacen dos LLMs
 * sueltos, y ya se midió aquí que convergen en estar de acuerdo.
 */
export async function runNegotiation(
  negotiationId: string,
  answerFromGraph: AnswerFromGraph,
): Promise<NegotiationStep> {
  let step = await stepNegotiation(negotiationId, answerFromGraph)
  while (step.asked !== null && step.state === 'open') {
    step = await stepNegotiation(negotiationId, answerFromGraph)
  }
  return step
}
