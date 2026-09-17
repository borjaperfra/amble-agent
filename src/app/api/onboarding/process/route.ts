import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate, listUnprocessedSources, listClaims } from '@/lib/db/repo'
import { processSource } from '@/lib/pipeline/sources'
import { claimsToEvidence, assessCapabilities, buildDistinctiveProfile, buildDescriptor } from '@/lib/pipeline/graph'
import { ModelNotConfiguredError } from '@/lib/features'

export const runtime = 'nodejs'
export const maxDuration = 300

function guard(): NextResponse | null {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  return null
}

export async function POST(request: Request) {
  const blocked = guard()
  if (blocked) return blocked

  const candidate = getOrCreateCandidate()
  const body = (await request.json().catch(() => ({}))) as { stage?: string; sourceId?: string }
  const stage = body.stage

  try {
    if (stage === 'sources') {
      const all = listUnprocessedSources(candidate.id)
      const sources = body.sourceId ? all.filter((source) => source.id === body.sourceId) : all
      const processed: { name: string; claimsCount: number; discoveries: { title: string; meta: string }[] }[] = []
      for (const source of sources) {
        const result = await processSource(source, candidate.id)
        processed.push({
          name: result.sourceName,
          claimsCount: result.claimsCount,
          discoveries: result.discoveries,
        })
      }
      return NextResponse.json({
        stage,
        processed,
        totalClaims: listClaims(candidate.id).length,
      })
    }

    if (stage === 'evidence') {
      const created = claimsToEvidence(candidate.id)
      return NextResponse.json({ stage, evidenceCreated: created })
    }

    if (stage === 'capabilities') {
      const result = await assessCapabilities(candidate.id)
      return NextResponse.json({
        stage,
        capabilitiesCount: result.capabilityCount,
        newUncertainties: result.uncertaintyCount,
      })
    }

    if (stage === 'profile') {
      const distinctive = await buildDistinctiveProfile(candidate.id)
      const descriptor = await buildDescriptor(candidate.id)
      return NextResponse.json({ stage, distinctiveCount: distinctive.length, descriptor })
    }

    return NextResponse.json({ error: 'Unknown processing stage.' }, { status: 400 })
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed.' },
      { status: 500 },
    )
  }
}
