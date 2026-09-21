/**
 * La memoria de la conversación, y la regla que la hace valer algo.
 *
 * Lo fácil de esto es guardar frases. Lo que se prueba aquí es lo otro: que
 * un consejo que no puede citar nada no llega a guardarse, y que el que sí
 * cita se cierra solo cuando llega lo que lo cubre.
 *
 * Sin la primera regla, la memoria se llena de «sigue así» y en dos semanas
 * no se puede leer. Sin la segunda, en noviembre le vuelve a aconsejar lo que
 * ya hizo en octubre — que es exactamente cómo se deja de leer a alguien.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Advice = typeof import('./advice')
type Repo = typeof import('./repo')

let advice: Advice
let repo: Repo
let candidateId: string
let workingDirectory: string
let previousDirectory: string

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-advice-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'

  advice = await import('./advice')
  repo = await import('./repo')
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

function given(text: string, uncertaintyIds: string[], side: 'rep' | 'candidate' = 'rep') {
  return advice.insertAdvice({
    candidate_id: candidateId,
    inbound_message_id: 'in_test',
    side,
    text,
    uncertainty_ids: uncertaintyIds,
    evidence_ids: [],
    opportunity_ids: [],
  })
}

describe('lo que queda dicho entre los dos', () => {
  it('guarda quién lo dijo, porque no es lo mismo', () => {
    const suyo = given('Voy a escribir el caso de Asgard.', ['unk_metrics'], 'candidate')
    const mio = given('Te falta un caso con números.', ['unk_metrics'])

    assert.equal(suyo.side, 'candidate')
    assert.equal(mio.side, 'rep')
    assert.equal(advice.listOpenAdvice(candidateId).length, 2)
  })

  it('nace abierto: un consejo sin cerrar es lo normal', () => {
    assert.equal(given('Mira las de infra.', ['unk_infra']).status, 'open')
  })
})

describe('cerrar lo que ha dejado de estar pendiente', () => {
  it('cierra el consejo cuando se resuelve el hueco del que hablaba', () => {
    const mine = given('Te falta enseñar tamaño de equipo.', ['unk_team'])
    const other = given('Y algo de analítica.', ['unk_analytics'])

    const closed = advice.addressAdviceFor(candidateId, ['unk_team'], 'in_answer_42')

    assert.equal(closed.length, 1)
    assert.equal(advice.getAdvice(mine.id)?.status, 'addressed')
    // Y deja quién lo cerró, que es lo que permite decir «esto cubre aquello».
    assert.equal(advice.getAdvice(mine.id)?.addressed_by, 'in_answer_42')
    assert.equal(advice.getAdvice(other.id)?.status, 'open', 'el otro sigue en pie')
  })

  it('no cierra nada cuando no se resolvió nada', () => {
    assert.deepEqual(advice.addressAdviceFor(candidateId, [], 'in_answer_43'), [])
  })

  it('deja de salir en lo que sigue en pie una vez cerrado', () => {
    const before = advice.listOpenAdvice(candidateId).length
    const one = given('Enséñale experimentos.', ['unk_experiments'])

    assert.equal(advice.listOpenAdvice(candidateId).length, before + 1)
    advice.addressAdviceFor(candidateId, ['unk_experiments'], 'in_answer_44')
    assert.equal(advice.listOpenAdvice(candidateId).length, before)
    assert.equal(advice.getAdvice(one.id)?.status, 'addressed')
  })

  it('lo que ya no viene a cuento se descarta sin fingir que se cumplió', () => {
    const stale = given('Mira las de Barcelona.', ['unk_location'])

    advice.dropAdvice(stale.id)

    // «Descartado» y «cubierto» no son lo mismo, y confundirlos sería
    // contarle que hizo algo que no hizo.
    assert.equal(advice.getAdvice(stale.id)?.status, 'dropped')
    assert.equal(advice.getAdvice(stale.id)?.addressed_by, null)
  })
})
