import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/auth/session'
import { latestDaily, sendOffsite } from '@/lib/db/backup'
import { getDb } from '@/lib/db/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// The owner takes a copy of the database off the host: the daily copies on the
// volume do not survive losing the volume itself.
export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const file = path.join(os.tmpdir(), `amble-export-${Date.now()}.db`)
  try {
    getDb().prepare('VACUUM INTO ?').run(file)
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

// The latest daily copy, up to R2 now: to see the bucket and its key work
// without waiting for the next morning's pass.
export async function POST() {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const file = latestDaily()
  if (!file) return NextResponse.json({ error: 'No daily copy on the volume yet.' }, { status: 409 })
  const result = await sendOffsite(file)
  if (!result) return NextResponse.json({ error: 'R2 is not set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).' }, { status: 409 })
  return NextResponse.json(result, { status: 'error' in result ? 502 : 200 })
}
