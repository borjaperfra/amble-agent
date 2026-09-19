import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { findOpportunityByFixtureKey } from '@/lib/db/opportunities'
import { ingestOpportunity } from '@/lib/pipeline/opportunities'
import { ensureManfredSyncScheduled } from '@/lib/pipeline/manfred-sync'
import { enqueue, queueStatus, resumeQueue } from '@/lib/pipeline/jobs'
import { getOpportunityLabViewModel } from '@/lib/opportunity-view'
import { HUMAN_LABELS, type HumanLabel } from '@/domains/opportunity/types'

export const runtime = 'nodejs'

/** Everything the lab shows, rebuilt from what is stored. Safe to poll. */
export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  resumeQueue()
  ensureManfredSyncScheduled(getOrCreateCandidate().id)
  return NextResponse.json(getOpportunityLabViewModel())
}

/**
 * Take an opportunity in, record the blind label beside it, and queue the
 * reading. Returns as soon as it is on the queue.
 *
 * The label arrives in the same request because the experiment requires it
 * to exist before anything runs — but it is written to its own table, and
 * nothing that builds a prompt ever reads that table.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as {
    company?: string
    role?: string
    url?: string
    rawText?: string
    fixtureKey?: string
    label?: string
    labelComment?: string
  } | null

  if (!body) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 })

  const company = body.company?.trim()
  const role = body.role?.trim()
  const rawText = body.rawText?.trim()

  if (!company || !role) {
    return NextResponse.json({ error: 'A company and a role, at least.' }, { status: 400 })
  }
  if (!rawText || rawText.length < 40) {
    return NextResponse.json(
      { error: 'Paste the opportunity itself. There is nothing to read in that.' },
      { status: 400 },
    )
  }
  if (body.label && !(HUMAN_LABELS as readonly string[]).includes(body.label)) {
    return NextResponse.json({ error: 'A label is YES, MAYBE or NO.' }, { status: 400 })
  }

  const candidate = getOrCreateCandidate()

  // A fixture run twice should not leave two of everything behind.
  if (body.fixtureKey) {
    const existing = findOpportunityByFixtureKey(candidate.id, body.fixtureKey)
    if (existing) {
      return NextResponse.json({
        id: existing.id,
        status: existing.status,
        alreadyPresent: true,
        queue: queueStatus(candidate.id),
      })
    }
  }

  const opportunity = ingestOpportunity({
    candidateId: candidate.id,
    company,
    role,
    url: body.url?.trim() || null,
    rawText,
    provenance: body.fixtureKey ? 'fixture' : 'manual',
    fixtureKey: body.fixtureKey?.trim() || null,
    label: body.label
      ? { label: body.label as HumanLabel, comment: body.labelComment ?? null }
      : null,
  })

  enqueue('evaluate_opportunity', candidate.id, { opportunityId: opportunity.id })

  return NextResponse.json({
    id: opportunity.id,
    status: opportunity.status,
    alreadyPresent: false,
    queue: queueStatus(candidate.id),
  })
}
