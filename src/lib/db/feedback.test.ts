/**
 * La libreta y la puerta.
 *
 * Dos cosas pequeñas y una que importa. Que una nota se guarda y se lee, que
 * el orden es el último arriba —porque lo que acaba de escribir es lo que
 * quiere ver—, y que borrar no toca una nota que no es suya. Hoy solo hay un
 * candidato y esa última comprobación no puede fallar nunca; justamente por
 * eso hay que probarla, porque el día que haya dos, nadie va a volver a
 * mirarla.
 *
 * De la puerta se prueba lo único que tiene sentido probar: que la
 * contraseña correcta abre, que otra no, y que sin contraseña configurada no
 * hay puerta — que es lo que mantiene el dev server como estaba.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Feedback = typeof import('./feedback')
type Repo = typeof import('./repo')
type Gate = typeof import('../gate')

let feedback: Feedback
let repo: Repo
let gate: Gate
let candidateId: string
let workingDirectory: string
let previousDirectory: string

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-feedback-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'

  feedback = await import('./feedback')
  repo = await import('./repo')
  gate = await import('../gate')

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

describe('la libreta', () => {
  it('guarda lo que escribe y lo devuelve con lo último arriba', () => {
    feedback.insertFeedbackNote(candidateId, 'La primera.')
    feedback.insertFeedbackNote(candidateId, '  La segunda, con espacios.  ')

    const notes = feedback.listFeedbackNotes(candidateId)
    assert.equal(notes.length, 2)
    assert.equal(notes[0].text, 'La segunda, con espacios.')
  })

  it('corta lo que no cabe en vez de rechazarlo', () => {
    const note = feedback.insertFeedbackNote(candidateId, 'x'.repeat(feedback.MAX_NOTE_LENGTH + 500))
    assert.equal(note.text.length, feedback.MAX_NOTE_LENGTH)
  })

  it('no borra una que no existe, y lo dice', () => {
    assert.equal(feedback.deleteFeedbackNote(candidateId, 'fb_nope'), false)
  })

  it('no borra la de otro aunque acierte el id', () => {
    const note = feedback.insertFeedbackNote(candidateId, 'Esta es suya.')

    assert.equal(feedback.deleteFeedbackNote('cand_otro', note.id), false)
    assert.ok(feedback.getFeedbackNote(note.id), 'sigue ahí')
  })

  it('borra la suya', () => {
    const note = feedback.insertFeedbackNote(candidateId, 'Esta sobra.')

    assert.equal(feedback.deleteFeedbackNote(candidateId, note.id), true)
    assert.equal(feedback.getFeedbackNote(note.id), undefined)
  })
})

describe('la puerta', () => {
  it('no existe cuando no hay contraseña puesta', () => {
    delete process.env.AMBLE_PASSWORD
    assert.equal(gate.gatePassword(), null)
  })

  it('abre con la buena y no con otra', () => {
    const token = gate.sessionToken('correcta')
    assert.equal(gate.tokenMatches(token, 'correcta'), true)
    assert.equal(gate.tokenMatches(token, 'otra'), false)
    assert.equal(gate.tokenMatches(undefined, 'correcta'), false)
    assert.equal(gate.tokenMatches('', 'correcta'), false)
  })

  it('no guarda la contraseña en la cookie', () => {
    assert.ok(!gate.sessionToken('correcta').includes('correcta'))
  })

  it('aguanta diez intentos y corta el once', () => {
    for (let i = 0; i < 10; i += 1) {
      assert.equal(gate.tooManyAttempts('1.2.3.4'), false, `intento ${i + 1}`)
      gate.recordFailedAttempt('1.2.3.4')
    }
    assert.equal(gate.tooManyAttempts('1.2.3.4'), true)
    // Y no castiga a quien no ha fallado.
    assert.equal(gate.tooManyAttempts('5.6.7.8'), false)
  })

  it('acertar limpia la cuenta: quien entra no estaba atacando', () => {
    for (let i = 0; i < 10; i += 1) gate.recordFailedAttempt('9.9.9.9')
    assert.equal(gate.tooManyAttempts('9.9.9.9'), true)

    gate.clearAttempts('9.9.9.9')
    assert.equal(gate.tooManyAttempts('9.9.9.9'), false)
  })

  it('la cookie no se puede calcular sin el fichero de la sal', () => {
    // El token lleva una sal de esta instalación, así que probar contraseñas
    // offline contra una cookie robada necesita primero el volumen.
    assert.match(gate.sessionToken('correcta'), /^[a-f0-9]{64}$/)
    assert.notEqual(
      gate.sessionToken('correcta'),
      createHash('sha256').update('amble:correcta').digest('hex'),
    )
  })

  it('compara contraseñas de distinta longitud sin romperse', () => {
    // `timingSafeEqual` lanza si los buffers no miden lo mismo, y por eso se
    // comparan los hashes y no las contraseñas: miden siempre igual.
    assert.equal(gate.passwordMatches('a', 'una contraseña mucho más larga'), false)
  })
})
