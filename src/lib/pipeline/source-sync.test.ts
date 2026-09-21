/**
 * Lo que pasó la criba y nadie llegó a mirar.
 *
 * Un sondeo evalúa como mucho `maxEvaluations` por pasada, porque cada una
 * son tres llamadas y un minuto. Las que sobran se guardan en `received` — y
 * en la pasada siguiente se saltaban por «ya conocida», así que se quedaban
 * ahí para siempre. En la instancia de Borja eran diez ofertas que habían
 * superado el filtro y sobre las que nunca se dijo nada, que es exactamente
 * el fallo que este producto existe para no cometer.
 *
 * Lo que se prueba es el orden: lo viejo se lleva el presupuesto antes que lo
 * nuevo. Lo nuevo puede esperar seis horas; lo que lleva esperando desde el
 * martes ya ha esperado bastante.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Sync = typeof import('./source-sync')
type Opportunities = typeof import('../db/opportunities')
type Repo = typeof import('../db/repo')
type Preferences = typeof import('./preferences')

let sync: Sync
let opportunities: Opportunities
let repo: Repo
let preferences: Preferences
let candidateId: string
let workingDirectory: string
let previousDirectory: string

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-sync-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'

  sync = await import('./source-sync')
  opportunities = await import('../db/opportunities')
  repo = await import('../db/repo')
  preferences = await import('./preferences')

  candidateId = repo.getOrCreateCandidate().id
  // Sin suelo de salario ni modalidad: lo que se mide aquí es el presupuesto
  // de evaluaciones, no la criba, y una criba que tumbe la mitad de las
  // fixtures mediría otra cosa.
  preferences.writePreferences(candidateId, { salaryMin: 0 })
})

after(() => {
  process.chdir(previousDirectory)
  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open a moment longer than we care about.
  }
})

/** Un tablón de mentira, con las ofertas que le pidas. */
function board(source: string, count: number, from = 1): import('../sources/types').FeedAdapter {
  const offers = Array.from({ length: count }, (_, index) => ({
    sourceRef: `${source}:${from + index}`,
    source,
    company: 'Solenne',
    role: `Head of Growth ${from + index}`,
    url: `https://example.test/${from + index}`,
    salaryMin: 150_000,
    salaryMax: 180_000,
    currency: 'EUR',
    workModel: 'remote' as const,
    locations: ['Remote'],
    equity: null,
    department: null,
    active: true,
    raw: {},
  }))
  return {
    source,
    list: async () => offers,
    rawText: async (offer) => `Posting for ${offer.role}.`,
  }
}

describe('el presupuesto de evaluaciones de un sondeo', () => {
  it('deja esperando lo que pasa del tope, y lo dice', async () => {
    const result = await sync.syncSource(candidateId, board('testboard', 5), {
      maxEvaluations: 2,
      pauseMs: 0,
    })

    assert.equal(result.imported, 5)
    assert.equal(result.queued, 2)
    assert.equal(result.waiting, 3)
    assert.equal(result.resumed, 0, 'en la primera pasada no hay nada viejo')
    assert.equal(opportunities.listUnevaluatedOpportunities(candidateId, 'testboard').length, 5)
  })

  it('en la pasada siguiente gasta el presupuesto en lo que ya esperaba', async () => {
    // Mismas cinco de antes más dos nuevas: sin esto, las cinco viejas se
    // saltan por «ya conocida» y no se evalúan nunca.
    const result = await sync.syncSource(candidateId, board('testboard', 7), {
      maxEvaluations: 2,
      pauseMs: 0,
    })

    assert.equal(result.alreadyKnown, 5)
    assert.equal(result.imported, 2, 'las dos nuevas entran igual')
    assert.equal(result.resumed, 2, 'y el presupuesto se va en las que esperaban')
    assert.equal(result.queued, 2)
    assert.equal(result.waiting, 2, 'las dos nuevas se quedan para la próxima')
  })

  it('no encola dos veces la misma oferta si el sondeo se reintenta', async () => {
    const before = await sync.syncSource(candidateId, board('retryboard', 3), {
      maxEvaluations: 3,
      pauseMs: 0,
    })
    assert.equal(before.queued, 3)

    // El mismo sondeo otra vez, como tras un corte a media pasada. Las tres
    // siguen en `received` porque sus trabajos no han llegado a correr.
    const again = await sync.syncSource(candidateId, board('retryboard', 3), {
      maxEvaluations: 3,
      pauseMs: 0,
    })
    assert.equal(again.resumed, 0, 'ya tenían trabajo en cola')
    assert.equal(again.queued, 0)
  })
})
