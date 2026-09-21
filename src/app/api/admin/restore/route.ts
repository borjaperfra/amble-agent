import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { DATA_DIRECTORY, DB_FILE, closeDb, getDb } from '@/lib/db/db'

export const runtime = 'nodejs'

/**
 * Llevarse el grafo del portátil al servidor.
 *
 * Existe porque la base es un fichero y el disco de Railway es un volumen al
 * que no se llega con `scp`. Sube el fichero, se reemplaza, y a partir de la
 * siguiente consulta el servidor es el portátil.
 *
 * Tres cosas antes de que esto haga nada, porque reemplazar la base entera es
 * la operación más destructiva que tiene este proyecto:
 *
 * 1. `AMBLE_ALLOW_RESTORE=true`. Se pone para migrar y se quita después. Sin
 *    ella esta ruta no existe.
 * 2. La contraseña, que ya la pide la puerta de delante para todo `/api`.
 * 3. Un fichero que de verdad sea una base de SQLite. Un POST con un PDF
 *    dentro dejaría el servidor sin base y sin forma de decir por qué.
 *
 * Lo que había se guarda al lado con la fecha. No se borra: el día que esto
 * salga mal, lo que estuviera dentro es lo único que no se puede rehacer.
 */
export async function POST(request: Request) {
  if (process.env.AMBLE_ALLOW_RESTORE?.trim() !== 'true') {
    return NextResponse.json({ error: 'Restore is not enabled here.' }, { status: 404 })
  }

  const uploaded = Buffer.from(await request.arrayBuffer())
  if (uploaded.length === 0) {
    return NextResponse.json({ error: 'Nothing came through.' }, { status: 400 })
  }

  // Los dieciséis primeros bytes de cualquier base de SQLite.
  if (uploaded.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
    return NextResponse.json({ error: 'That is not a SQLite database.' }, { status: 400 })
  }

  fs.mkdirSync(DATA_DIRECTORY, { recursive: true })

  try {
    closeDb()

    if (fs.existsSync(DB_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      fs.copyFileSync(DB_FILE, `${DB_FILE}.${stamp}.bak`)
    }

    // El diario y el índice compartido pertenecen a la base que se va. Dejar
    // los de la anterior junto a un fichero nuevo es cómo SQLite acaba
    // leyendo páginas de dos bases distintas.
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${DB_FILE}${suffix}`, { force: true })
    }

    fs.writeFileSync(DB_FILE, uploaded)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The restore failed.' },
      { status: 500 },
    )
  }

  // Abrirla aquí y no en la siguiente petición: si el fichero que subió no
  // sirve, que se entere ahora y con la copia todavía al lado.
  try {
    const candidates = getDb()
      .prepare('SELECT COUNT(*) AS n FROM candidates')
      .get() as unknown as { n: number }
    return NextResponse.json({ ok: true, bytes: uploaded.length, candidates: candidates.n })
  } catch (error) {
    return NextResponse.json(
      {
        error: `The file was written but does not open: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      },
      { status: 500 },
    )
  }
}

/**
 * Los ficheros que subió: el CV original y el texto extraído.
 *
 * Van aparte porque no están en la base, y sin ellos la traza del grafo
 * enseña las evidencias pero no el documento del que salieron.
 */
export async function PUT(request: Request) {
  if (process.env.AMBLE_ALLOW_RESTORE?.trim() !== 'true') {
    return NextResponse.json({ error: 'Restore is not enabled here.' }, { status: 404 })
  }

  const name = new URL(request.url).searchParams.get('name')?.trim() ?? ''
  // Solo un nombre de fichero, nunca una ruta: `../` aquí es escribir donde
  // le apetezca a quien llame.
  if (name.length === 0 || name !== path.basename(name) || name.startsWith('.')) {
    return NextResponse.json({ error: 'That name is not allowed.' }, { status: 400 })
  }

  const body = Buffer.from(await request.arrayBuffer())
  if (body.length === 0) {
    return NextResponse.json({ error: 'Nothing came through.' }, { status: 400 })
  }

  const directory = path.join(DATA_DIRECTORY, 'uploads')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, name), body)
  return NextResponse.json({ ok: true, name, bytes: body.length })
}
