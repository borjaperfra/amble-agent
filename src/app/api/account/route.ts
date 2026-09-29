import { NextResponse } from 'next/server'
import { deleteAccount, exportAccount } from '@/lib/account'
import { currentCandidate, endSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

// A copy of everything amble keeps about them, as a file to take away.
export async function GET() {
  const candidate = await currentCandidate()
  if (!candidate) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const day = new Date().toISOString().slice(0, 10)
  return new NextResponse(JSON.stringify(exportAccount(candidate.id), null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="amble-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}

// The account and everything in it, for good. They confirm with their own
// email address, so it is never one click away. The owner's account is the
// one amble listens with for everyone; it is not deleted from here.
export async function POST(request: Request) {
  const candidate = await currentCandidate()
  if (!candidate) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { action?: string; email?: string } | null
  if (body?.action !== 'delete') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  if (candidate.role === 'owner') return NextResponse.json({ error: 'owner' }, { status: 403 })
  const typed = (body.email ?? '').trim().toLowerCase()
  if (!candidate.email || typed !== candidate.email.toLowerCase()) return NextResponse.json({ error: 'email' }, { status: 400 })
  deleteAccount(candidate.id)
  await endSession()
  return NextResponse.json({ ok: true })
}
