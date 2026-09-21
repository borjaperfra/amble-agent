/**
 * Las cinco decisiones del 19, hechas código.
 *
 * Estaban escritas en prosa en el WIP y eran política: alguien tenía que
 * acordarse de respetarlas al escribir un prompt. Aquí dejan de serlo. Lo que
 * no puede salir no sale porque una función lo quita, no porque se le pida al
 * modelo que no lo diga.
 *
 * Es la misma idea que sostiene el resto del proyecto —no prometer, hacerlo
 * comprobable— aplicada a la parte donde más caro sale fallar: al otro lado
 * hay alguien con interés en saber más de él de lo que él ha autorizado.
 */

import type {
  DisclosableFact,
  DisclosureTier,
  NegotiationState,
  NegotiationTurn,
  Side,
  SideSignals,
} from './types'
import { NEVER_WITHOUT_ASKING } from './types'

// ─── 1. La escalera de divulgación ────────────────────────────────────────

export interface Redacted {
  released: DisclosableFact[]
  /** Lo que se quitó y por qué. La cuenta es la medida, igual que siempre. */
  withheld: { kind: string; why: string }[]
}

/**
 * «Lo supera», nunca 120.000.
 *
 * El ejemplo que diste, y es el corazón de la decisión 1: a «¿cuál es su
 * mínimo?» se responde que la oferta lo pasa, sin decir el número. La empresa
 * necesita saber si sigue hablando; para eso no le hace falta la cifra, y con
 * la cifra negocia contra él.
 *
 * Por eso la comparación se hace **aquí**, con el número delante, y lo que
 * sale es el resultado. Mandar el número al modelo y pedirle que no lo diga
 * es exactamente lo que este proyecto no hace.
 */
export function compareWithoutTelling(theirs: number, ours: number): string {
  if (theirs >= ours) return 'clears it'
  return 'falls short'
}

/**
 * Lo que puede salir, en este momento.
 *
 * Tres cosas, y las tres son literales del 19:
 *
 * - Nada sin evidencia detrás. Una respuesta que no se puede citar no es una
 *   respuesta, es una afirmación — y al otro lado la van a creer.
 * - En `guarded`, ni números ni identidad. Los números se convierten en «lo
 *   supera» o «se queda corto»; la identidad no sale de ninguna forma.
 * - Lo que él no ha soltado expresamente no sale nunca, en ningún nivel.
 */
export function redact(facts: readonly DisclosableFact[], tier: DisclosureTier): Redacted {
  const released: DisclosableFact[] = []
  const withheld: { kind: string; why: string }[] = []

  for (const fact of facts) {
    if (fact.evidenceIds.length === 0) {
      withheld.push({ kind: fact.kind, why: 'nothing in the graph backs it' })
      continue
    }

    if (NEVER_WITHOUT_ASKING.includes(fact.kind) && !fact.releasedByCandidate) {
      withheld.push({ kind: fact.kind, why: 'only leaves if he releases it himself' })
      continue
    }

    if (tier === 'guarded') {
      if (fact.kind === 'identity') {
        withheld.push({ kind: fact.kind, why: 'no name, no employer, no city before he says go' })
        continue
      }
      if (fact.kind === 'figure') {
        // No se tira: se convierte en lo único que la otra parte necesita.
        // Y si no trae número, no hay nada que redactar y no sale.
        if (typeof fact.value !== 'number') {
          withheld.push({ kind: fact.kind, why: 'a figure with no number to compare' })
          continue
        }
        released.push({ ...fact, text: fact.text, value: undefined })
        continue
      }
    }

    released.push(fact)
  }

  return { released, withheld }
}

/**
 * Antes de que él diga nada, su Rep sólo responde y nunca ofrece.
 *
 * Es la otra mitad de la decisión 1 y la más fácil de olvidar: no se trata
 * sólo de qué se cuenta, sino de quién empieza. Un Rep que en `guarded`
 * pregunta por su cuenta está abriendo una conversación que él no ha
 * autorizado.
 */
export function mayOpen(side: Side, tier: DisclosureTier): boolean {
  if (side === 'employer') return true
  return tier === 'introduced'
}

// ─── 2. Cuándo se molesta a un humano ─────────────────────────────────────

/**
 * A un humano no se le molesta hasta que esto esté terminado o atascado en
 * algo que sólo esa persona puede contestar.
 *
 * Y «atascado» no es «lleva rato»: es que un turno lo diga explícitamente. Un
 * tiempo de espera convertido en interrupción sería exactamente el producto
 * que esto no quiere ser.
 */
export function humanNeeded(
  state: NegotiationState,
  turns: readonly NegotiationTurn[],
): { who: Side; question: string } | null {
  if (state === 'agreed') return null
  const last = [...turns].reverse().find((turn) => turn.needsHuman)
  return last?.needsHuman ?? null
}

// ─── 3. Qué significa «acordado» ──────────────────────────────────────────

/**
 * Los dos lados pasan y a ninguno le queda un desconocido bloqueante.
 *
 * Calculado, no declarado. Cada parte corre sus propias reglas sobre lo suyo
 * y esto sólo mira los dos resultados — que es la razón de que ningún agente
 * pueda declarar un acuerdo ni por descuido ni porque el otro le convenza.
 *
 * Dos LLMs sueltos convergen en estar de acuerdo. Ya se midió aquí: el modelo
 * holdeaba todas las ofertas hasta que las reglas le pusieron la barra.
 */
export function isAgreed(ours: SideSignals, theirs: SideSignals): boolean {
  return (
    ours.hardFails === 0 &&
    theirs.hardFails === 0 &&
    ours.blockingUnknowns === 0 &&
    theirs.blockingUnknowns === 0
  )
}

/**
 * En qué punto está esto, según las dos partes y lo que se ha dicho.
 *
 * **El orden es la regla**, y lo aprendí rompiéndolo: la primera versión
 * miraba «acordado» lo primero, y entonces una conversación con dos preguntas
 * sin hacer y un humano esperando salía como acordada — porque ninguna de las
 * dos partes tenía todavía nada en contra. Claro que no: no había preguntado
 * nada.
 *
 * Así que primero lo que impide seguir, y sólo al final lo que permite
 * cerrar:
 *
 * 1. `dead`: un hard constraint que falla. Una ciudad, un visado, un suelo.
 *    No se arregla hablando, y seguir ahí es gastar llamadas en convencer a
 *    la aritmética.
 * 2. `stalled`: alguien espera a un humano. No se puede acordar nada mientras
 *    una de las partes no sabe lo que le han preguntado.
 * 3. `open`: quedan preguntas. El trabajo de los agentes es justamente
 *    averiguar antes de concluir, así que concluir antes es no haber
 *    trabajado.
 * 4. `agreed`: no queda nada que preguntar y a ninguno le queda nada en
 *    contra. Ése es el único sitio donde cabe.
 */
export function negotiationState(
  ours: SideSignals,
  theirs: SideSignals,
  turns: readonly NegotiationTurn[],
  /** Si todavía queda algo que preguntar. Sin esto se acuerda en el vacío. */
  questionsLeft = false,
): NegotiationState {
  if (ours.hardFails > 0 || theirs.hardFails > 0) return 'dead'
  if (turns.some((turn) => turn.needsHuman)) return 'stalled'
  if (questionsLeft) return 'open'
  return isAgreed(ours, theirs) ? 'agreed' : 'open'
}

// ─── 5. No se rankea ──────────────────────────────────────────────────────

/**
 * «Tres Reps quieren hablar», no una lista con puntuaciones.
 *
 * El §27 del spec: Amble representa personas, no las ordena. Así que lo que
 * el agente de la empresa puede devolver es una cuenta, y esta función existe
 * para que sea lo único que se pueda construir — el día que alguien quiera
 * ordenarlos, tendrá que venir aquí a romperlo a propósito, y eso es una
 * conversación de producto, no un descuido de una tarde.
 */
export function interestedReps(count: number): { count: number } {
  return { count: Math.max(0, Math.trunc(count)) }
}
