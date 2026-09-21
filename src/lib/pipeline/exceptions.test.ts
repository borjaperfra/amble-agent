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

  it('avisa cuando el modelo está fallando por debajo, donde el reintento lo tapa', () => {
    // Este era el agujero de este mismo parte: sólo miraba trabajos rendidos,
    // y casi ningún fallo del modelo llega ahí porque el reintento lo
    // resuelve. En el portátil fueron 43 de 255 y no lo dijo nada.
    const insert = db
      .getDb()
      .prepare(
        `INSERT INTO model_runs
           (id, candidate_id, task, task_version, provider, model_id, base_url,
            prompt_chars, output_chars, latency_ms, ok, error, created_at)
         VALUES (?, ?, 'opportunity_rubric', 'v1', 'test', 'test', 'test', 10, 10, 100, ?, ?, datetime('now'))`,
      )
    for (let i = 0; i < 20; i += 1) insert.run(`run_ok_${i}`, candidateId, 1, null)
    for (let i = 0; i < 5; i += 1) {
      insert.run(`run_bad_${i}`, candidateId, 0, 'Could not reach the model: fetch failed (ENOTFOUND)')
    }

    const failing = exceptions
      .listExceptions(candidateId)
      .find((item) => item.kind === 'model_failing')

    assert.ok(failing, '5 de 25 es un 20%, y eso se cuenta')
    assert.equal(failing.count, 5)
    assert.match(String(failing.detail), /ENOTFOUND/)
  })

  it('calla cuando fallar es lo normal de una red', () => {
    // Una llamada perdida y reintentada no es una noticia. Un parte que
    // habla de eso se deja de leer, y entonces tampoco se lee el día que sí.
    const insert = db
      .getDb()
      .prepare(
        `INSERT INTO model_runs
           (id, candidate_id, task, task_version, provider, model_id, base_url,
            prompt_chars, output_chars, latency_ms, ok, error, created_at)
         VALUES (?, ?, 'opportunity_match', 'v1', 'test', 'test', 'test', 10, 10, 100, 1, null, datetime('now'))`,
      )
    for (let i = 0; i < 200; i += 1) insert.run(`run_fine_${i}`, candidateId)

    // 5 fallos entre 225 llamadas es un 2%.
    const failing = exceptions
      .listExceptions(candidateId)
      .find((item) => item.kind === 'model_failing')
    assert.equal(failing, undefined)
  })
})
