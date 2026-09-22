/**
 * Lo que está en marcha por ti.
 *
 * Borja lo pidió así: *«No hay espacio para saber las ofertas que está
 * negociando tu Rep»*. Y tenía razón en lo que más duele — dijo que sí a una
 * y desde entonces no hay ni rastro. Actuó, y el producto le debe un estado.
 *
 * Pero esto roza una decisión cerrada, y merece decirse en voz alta: **HOLD e
 * IGNORE no se enseñan**. El silencio es la respuesta normal, y una lista de
 * las setenta que el Rep ha leído y descartado convierte esto en un tablón de
 * ofertas, que es exactamente lo que el spec dice que no es.
 *
 * Así que dos cosas distintas, tratadas distinto:
 *
 * - **Lo que él puso en marcha**, entero y por delante. Dijo que sí, y tiene
 *   derecho a saber qué ha pasado desde entonces — aunque la respuesta
 *   honesta hoy sea «nada, todavía no puedo hablar con ellos por ti».
 * - **Lo que está en espera**, sólo la cuenta y por qué. Es un problema del
 *   Rep, no suyo: le falta algo para decidir. Enseñarlo como una lista sería
 *   devolverle el trabajo que este producto existe para quitarle.
 */

import { getOpportunity, getResponse, listHeldOpportunities, listOpportunities } from './db/opportunities'

export interface InPlayItem {
  id: string
  role: string
  company: string
  url: string | null
  /** Cuándo dijo que sí. */
  since: string
  /** Qué ha pasado desde entonces, sin adornos. */
  status: 'waiting_on_us'
}

export interface HeldItem {
  id: string
  role: string
  company: string
  /** Qué le falta al Rep para decidir, en una línea. */
  blockedBy: string
}

export interface InPlayView {
  inPlay: InPlayItem[]
  held: HeldItem[]
}

export function inPlayView(candidateId: string): InPlayView {
  const inPlay: InPlayItem[] = []

  for (const opportunity of listOpportunities(candidateId)) {
    const response = getResponse(opportunity.id)
    if (response?.response !== 'HEAR_THEM_OUT') continue
    inPlay.push({
      id: opportunity.id,
      role: opportunity.role,
      company: opportunity.company,
      url: opportunity.url,
      since: response.created_at,
      // Hoy sólo hay un estado posible, y por eso está escrito como un valor
      // y no como un booleano: el día que el agente de la empresa conteste,
      // aquí habrá 'talking' y 'agreed', y el sitio donde ponerlos ya existe.
      status: 'waiting_on_us',
    })
  }

  inPlay.sort((a, b) => b.since.localeCompare(a.since))

  const held: HeldItem[] = listHeldOpportunities(candidateId).map(({ opportunity, decision }) => ({
    id: opportunity.id,
    role: opportunity.role,
    company: opportunity.company,
    blockedBy: decision.reason.slice(0, 180),
  }))

  return { inPlay, held }
}

/** Para cuando haga falta abrir una en concreto. */
export function inPlayOpportunity(id: string) {
  return getOpportunity(id)
}
