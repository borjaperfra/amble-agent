import { NextResponse } from 'next/server'
import { getOrCreateCandidate, listUnprocessedSources, listClaims } from '@/lib/db/repo'
import { processSource, SourceRejectedError } from '@/lib/pipeline/sources'
import { claimsToEvidence, assessCapabilities, buildDistinctiveProfile, buildDescriptor } from '@/lib/pipeline/graph'
import { ModelNotConfiguredError } from '@/lib/features'
import { ModelError } from '@/lib/model/provider'
import { serverText } from '@/lib/i18n/candidate'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const candidate = getOrCreateCandidate()
  const body = (await request.json().catch(() => ({}))) as { stage?: string; sourceId?: string }
  const stage = body.stage

  try {
    if (stage === 'sources') {
      const all = listUnprocessedSources(candidate.id)
      const sources = body.sourceId ? all.filter((source) => source.id === body.sourceId) : all
      const processed: { name: string; claimsCount: number; discoveries: { title: string; meta: string }[] }[] = []
      const rejected: { name: string; reason: string }[] = []
      for (const source of sources) {
        try {
          const result = await processSource(source, candidate.id)
          processed.push({
            name: result.sourceName,
            claimsCount: result.claimsCount,
            discoveries: result.discoveries,
          })
        } catch (error) {
          // One unusable source must not abort the batch: the others are still good.
          if (error instanceof SourceRejectedError) {
            rejected.push({ name: error.sourceName, reason: error.reason })
            continue
          }
          throw error
        }
      }
      return NextResponse.json({
        stage,
        processed,
        rejected,
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
    if (error instanceof ModelError) {
      return NextResponse.json({ error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed.' },
      { status: 500 },
    )
  }
}
