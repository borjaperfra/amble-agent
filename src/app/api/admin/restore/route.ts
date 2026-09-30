import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { DATA_DIRECTORY } from '@/lib/db/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// Moving an installation to a new host, once: the owner uploads a snapshot of
// the database (gzipped is fine) and the original files people gave it. It
// exists only while AMBLE_RESTORE_TOKEN is set; remove it once done.
//
//   curl -H "Authorization: Bearer $TOKEN" -F database=@amble.db.gz -F uploads=@src_x.original.pdf https://host/api/admin/restore

const MIN_TOKEN = 24
const MAX_DATABASE_BYTES = 2 * 1024 * 1024 * 1024

function authorised(request: Request): boolean {
  const token = process.env.AMBLE_RESTORE_TOKEN ?? ''
  if (token.length < MIN_TOKEN) return false
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const form = await request.formData().catch(() => null)
  const database = form?.get('database')
  if (!(database instanceof File)) return NextResponse.json({ error: 'A database file is required.' }, { status: 400 })

  let bytes = Buffer.from(await database.arrayBuffer())
  if (database.name.endsWith('.gz')) {
    // Unpacked within a bound: a small upload that inflates without end stops here.
    try {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_DATABASE_BYTES })
    } catch {
      return NextResponse.json({ error: 'The database could not be unpacked, or is larger than 2 GB.' }, { status: 400 })
    }
  }
  if (bytes.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
    return NextResponse.json({ error: 'That is not an SQLite database.' }, { status: 400 })
  }

  // The open connection lets go of the old file before it is replaced.
  globalThis.__ambleDb?.close()
  globalThis.__ambleDb = undefined
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true })
  for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(DATA_DIRECTORY, `amble.db${suffix}`), { force: true })
  fs.writeFileSync(path.join(DATA_DIRECTORY, 'amble.db'), bytes)

  const uploads = path.join(DATA_DIRECTORY, 'uploads')
  fs.mkdirSync(uploads, { recursive: true })
  let files = 0
  for (const entry of form?.getAll('uploads') ?? []) {
    if (!(entry instanceof File)) continue
    // Only a plain file name: nothing is written outside the uploads folder.
    const name = path.basename(entry.name)
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) continue
    fs.writeFileSync(path.join(uploads, name), Buffer.from(await entry.arrayBuffer()))
    files++
  }
  return NextResponse.json({ ok: true, databaseBytes: bytes.length, files })
}
