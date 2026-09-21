/**
 * Qué evidencia se manda, y sobre todo cuál no se deja fuera.
 *
 * El fallo caro aquí no es mandar de más: es dejarse la prueba que sostenía
 * un requisito, porque entonces sale un `NOT_SUPPORTED` que es mentira y una
 * oferta buena se cae en silencio. Nadie lo ve nunca — ni él, que no sabe que
 * existió, ni nosotros, que vemos un IGNORE perfectamente normal.
 *
 * Así que lo que se prueba es la contención: que por debajo del techo no toca
 * nada, que lo relevante sube, y que cuando la oferta no se parece a nada
 * suyo la lista se llena igual con lo mejor que tiene en vez de quedarse
 * corta.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MAX_EVIDENCE_FOR_MATCH, rubricTerms, selectEvidenceForMatch } from './selection'
import type { OpportunityRubric } from './types'

const rubric = (requirements: string[]): OpportunityRubric => ({
  roleScope: 'Head of Growth',
  seniority: null,
  companyStage: null,
  industry: 'developer tools',
  location: null,
  workModel: null,
  compensation: null,
  equity: null,
  environment: [],
  requirements: requirements.map((text, index) => ({
    id: `req_${index + 1}`,
    text,
    kind: 'capability' as const,
    importance: 'REQUIRED' as const,
  })),
  preferences: [],
  unknowns: [],
})

const evidence = (id: string, statement: string, over: Partial<{ strength: string; confidence: number; confirmed: number }> = {}) => ({
  id,
  statement,
  strength: over.strength ?? 'some',
  confidence: over.confidence ?? 0.5,
  candidate_confirmed: over.confirmed ?? 0,
})

/** Relleno, para pasar del techo sin que nada de esto sea relevante. */
function filler(count: number) {
  return Array.from({ length: count }, (_, index) =>
    evidence(`ev_filler_${index}`, 'Organised the summer party and the office move.'),
  )
}

describe('el techo', () => {
  it('por debajo no toca nada: si cabe, va entero', () => {
    const all = filler(10)
    const picked = selectEvidenceForMatch(all, [], new Map(), rubric(['anything']))

    assert.equal(picked.length, 10)
    assert.deepEqual(picked.map((item) => item.id), all.map((item) => item.id))
  })

  it('por encima corta, y corta donde dice', () => {
    const picked = selectEvidenceForMatch(filler(200), [], new Map(), rubric(['anything']))
    assert.equal(picked.length, MAX_EVIDENCE_FOR_MATCH)
  })
})

describe('qué sube y qué baja', () => {
  it('la que habla de lo que pide el anuncio va dentro', () => {
    const wanted = evidence('ev_wanted', 'Ran experimentation and A/B testing for a developer platform.')
    const picked = selectEvidenceForMatch(
      [...filler(200), wanted],
      [],
      new Map(),
      rubric(['Experimentation and A/B testing at scale']),
    )

    assert.ok(picked.some((item) => item.id === 'ev_wanted'))
  })

  it('la que sostiene una capacidad que la oferta toca pesa el doble', () => {
    // Su texto no dice nada del anuncio; lo que la salva es de qué capacidad
    // cuelga. Sin esa herencia, una prueba escrita en otras palabras se cae.
    const quiet = evidence('ev_quiet', 'Took it from a thousand to forty thousand in three years.')
    const picked = selectEvidenceForMatch(
      [...filler(200), quiet],
      [{ id: 'cap_growth', name: 'Developer tools growth', reason: 'Grew a developer platform.' }],
      new Map([['cap_growth', ['ev_quiet']]]),
      rubric(['Has grown a developer platform']),
    )

    assert.ok(picked.some((item) => item.id === 'ev_quiet'))
  })

  it('cuando nada se parece a la oferta, se llena con lo mejor que tiene', () => {
    // Una oferta rara no puede dejar la lista vacía: mandar tres pruebas y
    // concluir que no vale para nada es peor que mandar de más.
    const strong = evidence('ev_strong', 'Something entirely unrelated.', {
      strength: 'strong',
      confirmed: 1,
      confidence: 0.9,
    })
    const picked = selectEvidenceForMatch(
      [...filler(200), strong],
      [],
      new Map(),
      rubric(['Underwater basket weaving in zero gravity']),
    )

    assert.equal(picked.length, MAX_EVIDENCE_FOR_MATCH)
    assert.ok(picked.some((item) => item.id === 'ev_strong'), 'la fuerte y confirmada entra')
  })
})

describe('de qué va la oferta', () => {
  it('se queda con lo que distingue y tira lo que aparece en todas', () => {
    const terms = rubricTerms(rubric(['Strong experience with Python and Kubernetes']))

    assert.ok(terms.has('python'))
    assert.ok(terms.has('kubernetes'))
    assert.ok(!terms.has('experience'), 'aparece en todos los anuncios')
    assert.ok(!terms.has('strong'))
  })
})
