import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { includeCompany, listExcludedCompanies } from '@/lib/db/excluded-companies'

export const runtime = 'nodejs'

// The companies they want nothing from (#44), and the way back: undoing one
// lets its offers in again from the next look at the page.
//
// GET                                      -> { companies }
// POST { action: 'include', companyId }    -> { ok }

export async function GET(request: Request) {
  return forCandidate(request, async (candidate) => NextResponse.json({ companies: listExcludedCompanies(candidate.id) }))
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; companyId?: unknown }
    if (body.action !== 'include' || typeof body.companyId !== 'string') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    if (!includeCompany(candidate.id, body.companyId)) return NextResponse.json({ error: 'Not excluded.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
