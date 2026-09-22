/**
 * Los ids fuera de lo que lee una persona.
 *
 * El caso que da nombre a esto es literal: el 22 de septiembre Borja miró su
 * propio Mapa profesional y preguntó por qué había «urls metidas ahí en el
 * medio». Eran ids de evidencia, dentro de la frase que describe lo que sabe
 * hacer.
 *
 * Y lo que hace falta probar no es sólo que se van. Es lo otro: que lo que
 * queda se lee. Quitar «(ev_a, ev_b)» deja la frase limpia, pero quitarlo de
 * «(Google Analytics; ev_a, ev_b)» dejaba «(Google Analytics;,.» — que se lee
 * peor que el id que se acaba de quitar.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { stripIds } from './ids'

/** Tal y como estaba en su Mapa, en producción, el 22 de septiembre. */
const REAL =
  'Market research, user research and analytics sit inside documented GTM roles ' +
  '(ev_fc5e68e749254b87, ev_72093f7779ee4607) alongside quantified outcomes ' +
  '(ev_cd10f0ae176943e8), analytics tooling (Google Analytics, Amplitude; ' +
  'ev_77c591e4224e4b06, ev_a058f91e3d2b4c1d).'

describe('lo que lee una persona sobre sí misma', () => {
  it('no lleva dentro nuestro sistema de archivo', () => {
    const clean = stripIds(REAL)

    assert.doesNotMatch(clean, /\b(?:ev|clm|unc|opp|cap)_/)
    assert.match(clean, /Market research, user research and analytics/)
    assert.match(clean, /Google Analytics, Amplitude/, 'lo que sí era texto se queda')
  })

  it('y lo que queda se puede leer', () => {
    const clean = stripIds(REAL)

    // Lo que pasaba antes: «(Google Analytics, Amplitude;,.»
    assert.doesNotMatch(clean, /[;,:]\s*[.,;:)]/, 'sin puntuación huérfana')
    assert.doesNotMatch(clean, /\(\s*\)/, 'sin paréntesis vacíos')
    assert.ok(clean.endsWith('.'), `termina en punto: ${clean.slice(-40)}`)
  })

  it('no toca una frase que no lleva ninguno', () => {
    const plain = 'Llevó una comunidad de 120.000 desarrolladores durante tres años.'
    assert.equal(stripIds(plain), plain)
  })

  it('cubre los prefijos que se usan de verdad, no los que yo suponga', () => {
    // Comprobados contra la base y contra las llamadas a `newId()`. Una
    // versión anterior buscaba `unc_` y se dejaba `unk_`: un filtro que se
    // deja la mitad es peor que ninguno, porque parece que funciona.
    for (const id of ['ev_abc123', 'unc_abc123', 'unk_team', 'opp_abc123', 'clm_abc123']) {
      assert.doesNotMatch(stripIds(`Algo ${id} más`), /_/, id)
    }
  })
})
