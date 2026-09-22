/**
 * La lista de espera, que es la única parte de Amble que toca cualquiera.
 *
 * Todo lo demás está detrás de una contraseña. Esto no puede estarlo —el
 * sentido de una lista de espera es que entre gente que aún no tiene nada— y
 * eso cambia lo que hay que probar.
 *
 * Lo que más importa no es que guarde correos. Es que **apuntarse dos veces
 * conteste lo mismo**: si la respuesta cambiara, cualquiera podría averiguar
 * quién está en la lista probando direcciones, y eso es una fuga de datos de
 * otra gente disfrazada de detalle amable.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

type Waitlist = typeof import('./waitlist')

let waitlist: Waitlist
let workingDirectory: string
let previousDirectory: string

before(async () => {
  previousDirectory = process.cwd()
  workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-waitlist-'))
  process.chdir(workingDirectory)
  process.env.AMBLE_USER_ZERO = 'true'
  waitlist = await import('./waitlist')
})

after(() => {
  process.chdir(previousDirectory)
  try {
    fs.rmSync(workingDirectory, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open a moment longer than we care about.
  }
})

describe('apuntarse', () => {
  it('guarda el correo y lo cuenta', () => {
    assert.deepEqual(waitlist.joinWaitlist('alguien@ejemplo.com', 'landing'), { created: true })
    assert.equal(waitlist.waitlistCount(), 1)
  })

  it('apuntarse dos veces no crea dos filas', () => {
    waitlist.joinWaitlist('repetido@ejemplo.com', 'landing')
    const antes = waitlist.waitlistCount()

    assert.deepEqual(waitlist.joinWaitlist('repetido@ejemplo.com', 'landing'), { created: false })
    assert.equal(waitlist.waitlistCount(), antes)
  })

  it('y con mayúsculas o espacios sigue siendo la misma persona', () => {
    // «Borja@Ejemplo.com » y «borja@ejemplo.com» esperan la misma invitación.
    waitlist.joinWaitlist('  Mixto@Ejemplo.COM ', 'landing')
    const antes = waitlist.waitlistCount()

    assert.deepEqual(waitlist.joinWaitlist('mixto@ejemplo.com', 'landing'), { created: false })
    assert.equal(waitlist.waitlistCount(), antes)
  })

  it('guarda el correo normalizado, no lo que se escribió', () => {
    waitlist.joinWaitlist('  OTRO@Ejemplo.com ', 'landing')
    const emails = waitlist.listWaitlist().map((row) => row.email)

    assert.ok(emails.includes('otro@ejemplo.com'))
    assert.ok(!emails.some((email) => /[A-Z\s]/.test(email)), 'ninguno con mayúsculas ni espacios')
  })

  it('lo último primero: lo que se quiere ver es quién acaba de llegar', () => {
    const emails = waitlist.listWaitlist().map((row) => row.email)
    assert.equal(emails[0], 'otro@ejemplo.com')
  })
})

describe('qué se acepta como correo', () => {
  it('lo que claramente lo es', () => {
    for (const email of ['a@b.co', 'borja@helmcode.com', 'nombre.apellido+etiqueta@sub.dominio.es']) {
      assert.equal(waitlist.looksLikeEmail(email), true, email)
    }
  })

  it('y no lo que claramente no', () => {
    for (const bad of ['', 'borja', 'borja@', '@ejemplo.com', 'a@b', 'dos@arrobas@mal.com', 'con espacio@mal.com', 'a@.com', 'a@b.']) {
      assert.equal(waitlist.looksLikeEmail(bad), false, bad || '(vacío)')
    }
  })

  it('pero no se pone estricto con direcciones válidas y raras', () => {
    // Una expresión estricta rechaza correos que existen. Lo que de verdad
    // dice si una dirección funciona es mandarle algo, y eso pasará el día
    // del lanzamiento.
    assert.equal(waitlist.looksLikeEmail("o'brien@ejemplo.ie"), true)
    assert.equal(waitlist.looksLikeEmail('correo_raro-pero+valido@x.museum'), true)
  })

  it('ni con uno absurdamente largo', () => {
    assert.equal(waitlist.looksLikeEmail(`${'x'.repeat(250)}@ejemplo.com`), false)
  })
})
