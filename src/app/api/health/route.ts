import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// For the host: the server answers and its database opens.
export function GET() {
  try {
    getDb().prepare('SELECT 1').get()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
