import { NextResponse } from 'next/server'
import { isOwner } from '@/lib/auth/session'
import { countOpportunities, listCompanies } from '@/lib/db/opportunities'
import { runSourcing, watchCompany } from '@/lib/sourcing/run'
import { theirStackConfigured } from '@/lib/sourcing/theirstack'

export const runtime = 'nodejs'
export const maxDuration = 300

// GET                                            -> watched companies and offer counts
// POST { action: 'watch', name, careersUrl? }    -> find a company's board and watch it
// POST { action: 'run' }                         -> read every watched board now
//
// The owner's tools: for anyone else there is nothing here.

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({
    totals: countOpportunities(),
    theirstack: theirStackConfigured(),
    companies: listCompanies().map((company) => ({
      id: company.id,
      name: company.name,
      status: company.status,
      board: company.ats ? `${company.ats}/${company.ats_token}` : null,
      lastFetchedAt: company.last_fetched_at,
      lastError: company.last_error,
      discoveredVia: company.discovered_via,
    })),
  })
}

export async function POST(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { action?: string; name?: string; careersUrl?: string }
  try {
    if (body.action === 'watch') {
      const name = body.name?.trim()
      if (!name) return NextResponse.json({ error: 'A company name is required.' }, { status: 400 })
      const { company, board } = await watchCompany({ name, careersUrl: body.careersUrl?.trim() || null })
      return NextResponse.json({ company: { id: company.id, name: company.name, status: company.status }, board })
    }
    if (body.action === 'run') {
      return NextResponse.json(await runSourcing())
    }
    return NextResponse.json({ error: 'action must be watch or run.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sourcing failed.' }, { status: 500 })
  }
}
