import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/auth/session'
import { loadHealth, loadWhatsAppAccount } from '@/lib/admin/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// How amble is doing, for the owner. Anyone else finds nothing here.
//
// GET -> { health, whatsapp }

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ health: loadHealth(), whatsapp: await loadWhatsAppAccount() })
}
