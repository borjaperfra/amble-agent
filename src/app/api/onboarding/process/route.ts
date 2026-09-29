import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { setupProgress, startSetup } from '@/lib/pipeline/setup'

export const runtime = 'nodejs'

// POST { stage: 'start' }    -> reading what they shared starts, in the background
// POST { stage: 'progress' } -> how far it has got
// The reading itself is pipeline/setup.ts; it runs while they answer what
// they are looking for.
export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { stage?: string }
    if (body.stage === 'start') return NextResponse.json(startSetup(candidate.id))
    if (body.stage === 'progress') return NextResponse.json(setupProgress(candidate.id) ?? startSetup(candidate.id))
    return NextResponse.json({ error: 'Unknown processing stage.' }, { status: 400 })
  })
}
