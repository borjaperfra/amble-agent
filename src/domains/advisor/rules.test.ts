/**
 * Que ninguna fuente sea inventada.
 *
 * Cuando el Rep pasa de decidir a aconsejar, empieza a afirmar cosas sobre él
 * —«tus métricas son autodeclaradas», «no tienes profundidad analítica»— y
 * eso se lee como verdad. En una decisión, si el modelo se inventa algo, las
 * reglas la tumban. En un consejo no hay nada que tumbar: se lee y se cree.
 *
 * Así que la misma regla que la explicación de una oferta, y aquí se prueba:
 * lo que no se puede trazar se descarta en vez de enseñarse, y se cuenta. Un
 * id que no está en el grafo es exactamente igual de convincente que uno real
 * — la diferencia sólo la ve el código.
 *
 * El caso que da nombre a esto: la primera respuesta de verdad en producción
 * llevaba «(unc_60a5d2da7e1a48e7)» dentro de la prosa. Los ids resultaron ser
 * reales, pero nadie lo había comprobado y el candidato leyó un identificador
 * interno en un consejo sobre su carrera.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { auditAdvice, renderAdvice, stripIds } from './rules'

const GROUNDS = {
  evidenceIds: ['ev_community', 'ev_growth'],
  uncertaintyIds: ['unc_team', 'unc_analytics'],
  opportunityIds: ['opp_nomad'],
}

const point = (text: string, over: Partial<Record<string, string[]>> = {}) => ({
  text,
  evidenceIds: over.evidenceIds ?? [],
  uncertaintyIds: over.uncertaintyIds ?? [],
  opportunityIds: over.opportunityIds ?? [],
})

describe('los ids no son lenguaje', () => {
  it('los saca de la prosa, con paréntesis y todo', () => {
    assert.equal(
      stripIds('Tus métricas son autodeclaradas (unc_60a5d2da7e1a48e7).'),
      'Tus métricas son autodeclaradas.',
    )
  })

  it('también cuando van varios juntos', () => {
    assert.equal(
      stripIds('Te falta método [unc_944df7ea5f39479f, unc_be409e9fd51743a2] y se nota.'),
      'Te falta método y se nota.',
    )
  })

  it('y cuando van sueltos en medio de la frase', () => {
    assert.match(stripIds('Mira la de Nomad opp_aabc6dc6d6ae4577 antes.'), /^Mira la de Nomad antes\.$/)
  })

  it('no se lleva por delante una palabra normal', () => {
    assert.equal(stripIds('Evidencia de que llevaste el equipo.'), 'Evidencia de que llevaste el equipo.')
  })
})

describe('cada cosa dicha se apoya en algo que existe', () => {
  it('deja pasar lo que cita evidencia de verdad', () => {
    const audit = auditAdvice(
      { points: [point('Llevaste una comunidad grande.', { evidenceIds: ['ev_community'] })], askBack: null },
      GROUNDS,
    )

    assert.equal(audit.points.length, 1)
    assert.deepEqual(audit.points[0].evidenceIds, ['ev_community'])
    assert.equal(audit.dropped.length, 0)
  })

  it('tira lo que no cita nada, y dice por qué', () => {
    const audit = auditAdvice({ points: [point('Vas muy bien, sigue así.')], askBack: null }, GROUNDS)

    assert.equal(audit.points.length, 0)
    assert.equal(audit.dropped.length, 1)
    assert.match(audit.dropped[0].why, /nothing behind it/)
  })

  it('tira lo que cita un id inventado, y lo distingue del anterior', () => {
    const audit = auditAdvice(
      { points: [point('El mercado paga más.', { evidenceIds: ['ev_no_existe'] })], askBack: null },
      GROUNDS,
    )

    assert.equal(audit.points.length, 0)
    // Un id inventado es tan convincente como uno real, y hay que poder
    // contarlos por separado: uno es el modelo inventándose fuentes.
    assert.match(audit.dropped[0].why, /not in the graph/)
  })

  it('se queda sólo con los ids buenos de un punto que mezcla', () => {
    const audit = auditAdvice(
      {
        points: [point('Falta método.', { uncertaintyIds: ['unc_analytics', 'unc_inventada'] })],
        askBack: null,
      },
      GROUNDS,
    )

    assert.deepEqual(audit.points[0].uncertaintyIds, ['unc_analytics'])
    assert.equal(audit.dropped.length, 0, 'el punto se sostiene por el bueno')
  })

  it('la pregunta de vuelta no necesita apoyo: no afirma nada', () => {
    const audit = auditAdvice({ points: [], askBack: '¿Cuánto de eso fue tuyo?' }, GROUNDS)
    assert.equal(audit.askBack, '¿Cuánto de eso fue tuyo?')
  })
})

describe('lo que se le acaba enseñando', () => {
  it('junta los puntos y deja la pregunta al final', () => {
    const audit = auditAdvice(
      {
        points: [
          point('Uno.', { evidenceIds: ['ev_community'] }),
          point('Dos.', { uncertaintyIds: ['unc_team'] }),
        ],
        askBack: '¿Y tú qué crees?',
      },
      GROUNDS,
    )

    assert.equal(renderAdvice(audit, 'nada'), 'Uno.\n\nDos.\n\n¿Y tú qué crees?')
  })

  it('cuando no queda nada en pie, lo dice en vez de rellenar', () => {
    const audit = auditAdvice({ points: [point('Ánimo, tú puedes.')], askBack: null }, GROUNDS)

    // Un asesor que siempre tiene algo que decir está completando frases.
    assert.equal(renderAdvice(audit, 'No puedo contestarte eso sin inventármelo.'),
      'No puedo contestarte eso sin inventármelo.')
  })

  it('y aun así pregunta, si tenía algo que preguntar', () => {
    const audit = auditAdvice({ points: [], askBack: '¿Llevaste equipo?' }, GROUNDS)
    assert.equal(renderAdvice(audit, 'No lo sé.'), 'No lo sé.\n\n¿Llevaste equipo?')
  })

  it('no deja ningún id suelto en lo que se lee', () => {
    const audit = auditAdvice(
      {
        points: [point('Falta método (unc_analytics).', { uncertaintyIds: ['unc_analytics'] })],
        askBack: null,
      },
      GROUNDS,
    )

    assert.doesNotMatch(renderAdvice(audit, 'nada'), /unc_|ev_|opp_/)
    // Pero la trazabilidad no se pierde: vive en el campo, comprobable.
    assert.deepEqual(audit.points[0].uncertaintyIds, ['unc_analytics'])
  })
})
