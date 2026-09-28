import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/auth/session'
import { getDb } from '@/lib/db/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// The owner takes a copy of the database off the host: the daily copies on the
// volume do not survive losing the volume itself.
export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const file = path.join(os.tmpdir(), `amble-export-${Date.now()}.db`)
  try {
    getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    const body = gzipSync(fs.readFileSync(file))
    const day = new Date().toISOString().slice(0, 10)
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="amble-${day}.db.gz"`,
        'Cache-Control': 'no-store',
      },
    })
  } finally {
    fs.rmSync(file, { force: true })
  }
}
