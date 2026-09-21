/**
 * Las cinco decisiones del 19, comprobadas.
 *
 * Estaban en prosa en el WIP, o sea que eran política: alguien tenía que
 * acordarse de respetarlas cada vez que tocara un prompt. Esto es la prueba
 * de que ya no lo son.
 *
 * Importa más aquí que en ningún otro sitio del proyecto, porque al otro lado
 * de esta conversación hay alguien con un interés legítimo en saber de él más
 * de lo que él ha autorizado. En todo lo demás, si una regla falla, alguien
 * ve una oferta que no le tocaba. Aquí, si falla, se cuenta de él algo que no
 * quería contar — y eso no se puede deshacer.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  compareWithoutTelling,
  humanNeeded,
  interestedReps,
  isAgreed,
  mayOpen,
  negotiationState,
  redact,
} from './rules'
import { TURN_KINDS } from './types'
import type { DisclosableFact, NegotiationTurn } from './types'

const fact = (over: Partial<DisclosableFact> & Pick<DisclosableFact, 'kind'>): DisclosableFact => ({
  text: 'something',
  evidenceIds: ['ev_1'],
  ...over,
})

describe('1 · la escalera de divulgación', () => {
  it('no deja salir nada que no pueda citarse', () => {
    const { released, withheld } = redact([fact({ kind: 'capability', evidenceIds: [] })], 'introduced')

    assert.equal(released.length, 0)
    assert.match(withheld[0].why, /nothing in the graph/)
  })

  it('a «¿cuál es su mínimo?» contesta que lo supera, sin el número', () => {
    // El ejemplo literal del 19. Y la comparación se hace aquí, con el número
    // delante: mandárselo al modelo y pedirle que no lo diga es justo lo que
    // este proyecto no hace.
    assert.equal(compareWithoutTelling(150_000, 120_000), 'clears it')
    assert.equal(compareWithoutTelling(90_000, 120_000), 'falls short')

    const { released } = redact(
      [fact({ kind: 'figure', text: 'clears it', value: 120_000 })],
      'guarded',
    )
    assert.equal(released.length, 1)
    assert.equal(released[0].value, undefined, 'la cifra no viaja')
    assert.equal(released[0].text, 'clears it')
  })

  it('ni nombre, ni empresa actual, ni ciudad antes de que él diga adelante', () => {
    const { released, withheld } = redact([fact({ kind: 'identity', text: 'Borja, Valencia' })], 'guarded')

    assert.equal(released.length, 0)
    assert.match(withheld[0].why, /no name, no employer, no city/)
  })

  it('y después sí, porque eso es lo que significa decir adelante', () => {
    const { released } = redact([fact({ kind: 'identity', text: 'Borja, Valencia' })], 'introduced')
    assert.equal(released.length, 1)
  })

  it('lo que escribió en bruto no sale nunca, ni siquiera presentado', () => {
    // Sus «no» tal cual, sus dudas sobre el empleo actual, la entrevista en
    // crudo. Un «no» en sus palabras dice mucho más que un no, y una duda
    // sobre dónde trabaja ahora puede costarle el trabajo que tiene.
    const raw = [fact({ kind: 'verbatim', text: 'La verdad es que allí ya no aguanto más.' })]

    assert.equal(redact(raw, 'guarded').released.length, 0)
    assert.equal(redact(raw, 'introduced').released.length, 0, 'tampoco presentado')
    assert.match(redact(raw, 'introduced').withheld[0].why, /he releases it himself/)
  })

  it('salvo que lo suelte él, que es la única llave', () => {
    const released = redact(
      [fact({ kind: 'verbatim', text: 'Díselo tal cual.', releasedByCandidate: true })],
      'guarded',
    ).released

    assert.equal(released.length, 1)
  })

  it('antes de que él diga nada, su Rep responde pero no abre', () => {
    assert.equal(mayOpen('rep', 'guarded'), false)
    assert.equal(mayOpen('rep', 'introduced'), true)
    // La empresa sí: la oferta es suya y ya es pública.
    assert.equal(mayOpen('employer', 'guarded'), true)
  })
})

describe('2 · cuándo se molesta a un humano', () => {
  const turn = (over: Partial<NegotiationTurn> = {}): NegotiationTurn => ({
    side: 'employer',
    kind: 'question',
    text: '¿?',
    facts: [],
    ...over,
  })

  it('no se le molesta mientras la cosa avanza', () => {
    assert.equal(humanNeeded('open', [turn(), turn({ side: 'rep', kind: 'answer' })]), null)
  })

  it('sí cuando un turno dice que sólo puede contestarlo esa persona', () => {
    const asked = humanNeeded('stalled', [
      turn(),
      turn({ side: 'rep', kind: 'answer', needsHuman: { who: 'rep', question: '¿Te mudarías?' } }),
    ])

    assert.equal(asked?.who, 'rep')
    assert.match(String(asked?.question), /mudarías/)
  })

  it('y no cuando ya está acordado, por mucho que quedara una duda', () => {
    assert.equal(
      humanNeeded('agreed', [
        turn({ side: 'rep', needsHuman: { who: 'rep', question: '¿Te mudarías?' } }),
      ]),
      null,
    )
  })
})

describe('3 · qué significa acordado', () => {
  const clean = { hardFails: 0, blockingUnknowns: 0 }

  it('los dos lados pasan y a ninguno le queda un bloqueante', () => {
    assert.equal(isAgreed(clean, clean), true)
  })

  it('no basta con que lo esté uno', () => {
    assert.equal(isAgreed(clean, { hardFails: 1, blockingUnknowns: 0 }), false)
    assert.equal(isAgreed({ hardFails: 0, blockingUnknowns: 2 }, clean), false)
  })

  it('ningún agente puede declararlo: no hay dónde escribirlo', () => {
    // La decisión 3 hecha estructura. No es que un turno de tipo «acuerdo»
    // esté prohibido — es que no existe, así que no hay campo que rellenar.
    assert.deepEqual([...TURN_KINDS], ['question', 'answer'])
  })

  it('un hard constraint que falla la mata, en vez de seguir preguntando', () => {
    // Una ciudad, un visado o un suelo no se arreglan hablando, y seguir
    // ahí es gastar llamadas en convencer a la aritmética.
    assert.equal(negotiationState(clean, { hardFails: 1, blockingUnknowns: 0 }, []), 'dead')
  })

  it('y mientras nadie se atasque, sigue abierta', () => {
    assert.equal(negotiationState({ hardFails: 0, blockingUnknowns: 1 }, clean, []), 'open')
  })

  it('no se acuerda nada mientras queden preguntas sin hacer', () => {
    // El fallo que tuve: la primera versión miraba «acordado» lo primero, y
    // una conversación con dos preguntas pendientes salía acordada — porque
    // ninguna parte tenía nada en contra. Claro: no había preguntado nada.
    assert.equal(negotiationState(clean, clean, [], true), 'open')
    assert.equal(negotiationState(clean, clean, [], false), 'agreed')
  })

  it('ni con un humano esperando, por muy limpias que estén las dos partes', () => {
    const waiting = [
      {
        side: 'employer' as const,
        kind: 'answer' as const,
        text: 'No lo sé.',
        facts: [],
        needsHuman: { who: 'employer' as const, question: '¿El techo real?' },
      },
    ]
    assert.equal(negotiationState(clean, clean, waiting, false), 'stalled')
  })
})

describe('5 · no se rankea', () => {
  it('lo que sale es una cuenta, y no hay forma de sacar una lista', () => {
    // §27: Amble representa personas, no las ordena. El día que alguien
    // quiera el orden tendrá que venir aquí a romperlo a propósito, que es
    // una conversación de producto y no el descuido de una tarde.
    assert.deepEqual(interestedReps(3), { count: 3 })
    assert.deepEqual(Object.keys(interestedReps(3)), ['count'])
  })
})
