/**
 * Llevarse la base de aquí al servidor.
 *
 *   npm run push:db -- https://amble.up.railway.app
 *
 * Pide la contraseña, hace una copia limpia de la base, la sube, y detrás
 * sube los ficheros de `uploads/`.
 *
 * La copia se hace con `VACUUM INTO` y no copiando el fichero: mientras el
 * dev server esté vivo hay un `-wal` con escrituras que todavía no están en
 * el `.db`, y copiarlo a pelo se lleva una base a medias. `VACUUM INTO`
 * escribe una base entera y consistente en un fichero nuevo.
 *
 * En el servidor hace falta `AMBLE_ALLOW_RESTORE=true` mientras dure esto.
 * Quítalo después: es una ruta que reemplaza la base entera.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { DatabaseSync } from 'node:sqlite'

const target = process.argv[2]?.replace(/\/+$/, '')
if (!target) {
  console.error('Uso: npm run push:db -- https://tu-app.up.railway.app')
  process.exit(1)
}

const dataDir = path.join(process.cwd(), '.amble-data')
const source = path.join(dataDir, 'amble.db')
if (!fs.existsSync(source)) {
  console.error(`No hay base en ${source}.`)
  process.exit(1)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const password = await rl.question('Contraseña de Amble: ')
rl.close()

// ── Entrar, y quedarse con la cookie ──────────────────────────────────────

const login = await fetch(`${target}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
})
if (!login.ok) {
  console.error(`No ha dejado entrar (HTTP ${login.status}).`)
  process.exit(1)
}
const cookie = (login.headers.getSetCookie?.() ?? [])
  .map((value) => value.split(';')[0])
  .join('; ')
if (!cookie) {
  console.error('Ha dejado entrar pero no ha devuelto cookie. Revisa AMBLE_PASSWORD.')
  process.exit(1)
}

// ── Una copia entera y consistente ────────────────────────────────────────

const snapshot = path.join(os.tmpdir(), `amble-snapshot-${Date.now()}.db`)
const db = new DatabaseSync(source, { readOnly: true })
db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`)
db.close()

const bytes = fs.readFileSync(snapshot)
console.log(`Base: ${(bytes.length / 1024 / 1024).toFixed(1)} MB`)

const restore = await fetch(`${target}/api/admin/restore`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', cookie },
  body: bytes,
})
const result = await restore.json().catch(() => null)
fs.rmSync(snapshot, { force: true })

if (!restore.ok) {
  console.error(`No se ha subido (HTTP ${restore.status}): ${result?.error ?? 'sin motivo'}`)
  if (restore.status === 404) {
    console.error('¿Está AMBLE_ALLOW_RESTORE=true en Railway?')
  }
  process.exit(1)
}
console.log(`Subida. ${result.candidates} candidato(s) dentro.`)

// ── Y los ficheros que subió en su día ────────────────────────────────────

const uploads = path.join(dataDir, 'uploads')
if (!fs.existsSync(uploads)) {
  console.log('Sin uploads que llevar.')
  process.exit(0)
}

for (const name of fs.readdirSync(uploads)) {
  const file = path.join(uploads, name)
  if (!fs.statSync(file).isFile()) continue

  const response = await fetch(`${target}/api/admin/restore?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', cookie },
    body: fs.readFileSync(file),
  })
  console.log(`${response.ok ? '·' : '✗'} ${name}`)
}

console.log('\nListo. Quita AMBLE_ALLOW_RESTORE de Railway.')
