/**
 * El parte de excepciones, y lo que tiene que callar.
 *
 * Lo que se prueba primero es el silencio: una instalación sana no enseña
 * nada. Un parte que siempre tiene algo que decir se ignora a la semana, y
 * entonces el día que sí importa tampoco se lee.
 *
 * Y después lo contrario: que lo que pasó de verdad el 21 de septiembre —diez
 * ofertas que superaron la criba y llevaban días sin decidirse, sin una línea
 * en ningún log— aparezca. Con la holgura puesta a propósito: una cola sana
 * se vacía en horas, así que dos días es de sobra para no avisar de algo que
 * se iba a resolver solo.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Exceptions = typeof import('./exceptions')
type Opportunities = typeof import('../db/opportunities')
type Repo = typeof import('../db/repo')
type Db = typeof import('../db/db')

let exceptions: Exceptions
let opportunities: Opportunities
let repo: Repo
let db: Db
let candidateId: string
let workingDirectory: string
let previousDirectory: string

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-exceptions-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'

  exceptions = await import('./exceptions')
  opportunities = await import('../db/opportunities')
  repo = await import('../db/repo')
  db = await import('../db/db')

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

/** Una oferta que pasó la criba, con la antigüedad que le pidas. */
function received(role: string, daysAgo: number): string {
  const opportunity = opportunities.insertOpportunity({
    candidate_id: candidateId,
    company: 'Solenne',
    role,
    url: null,
    raw_text: 'A posting.',
    provenance: 'test',
  })
  db.getDb()
    .prepare("UPDATE opportunities SET created_at = datetime('now', ?) WHERE id = ?")
    .run(`-${daysAgo} days`, opportunity.id)
  return opportunity.id
}

describe('el parte de excepciones', () => {
  it('no dice nada cuando no hay nada que decir', () => {
    assert.deepEqual(exceptions.listExceptions(candidateId), [])
  })

  it('calla sobre una que acaba de entrar y todavía tiene su turno', () => {
    received('Head of Growth', 0)
    assert.deepEqual(exceptions.listExceptions(candidateId), [])
  })

  it('avisa de la que pasó el filtro y lleva días sin decidirse', () => {
    received('VP Marketing', 5)
    received('Head of Community', 9)

    const report = exceptions.listExceptions(candidateId)
    const stuck = report.find((item) => item.kind === 'stuck_opportunities')

    assert.ok(stuck, 'sale en el parte')
    assert.equal(stuck.count, 2, 'la de hoy no cuenta')
    // Lo que se puede perseguir es el nombre, no «hubo un error».
    assert.match(String(stuck.detail), /VP Marketing/)
  })

  it('cuenta los trabajos que se rindieron, con su motivo', () => {
    db.getDb()
      .prepare(
        `INSERT INTO jobs (id, candidate_id, kind, payload, status, attempts, run_after, last_error, created_at, updated_at)
         VALUES (?, ?, 'evaluate_opportunity', '{}', 'failed', 6, datetime('now'), ?, datetime('now'), datetime('now'))`,
      )
      .run('job_test_failed', candidateId, 'The model returned an empty response.')

    const failed = exceptions
      .listExceptions(candidateId)
      .find((item) => item.kind === 'failed_jobs')

    assert.ok(failed)
    assert.equal(failed.count, 1)
    assert.match(String(failed.detail), /empty response/)
  })

  it('habla en inglés si es el idioma del Rep', () => {
    const report = exceptions.listExceptions(candidateId, 'en')
    const stuck = report.find((item) => item.kind === 'stuck_opportunities')
    assert.match(String(stuck?.summary), /have still not been decided/)
  })
})
