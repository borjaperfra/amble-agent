import { NextResponse } from 'next/server'
import { ModelNotConfiguredError } from '@/lib/features'
import { confirmLatestIntent, interpretIntent } from '@/lib/pipeline/intent'
import { ModelError } from '@/lib/model/provider'
import { forCandidate } from '@/lib/auth/request'
import { refreshDetectedLocale, serverText } from '@/lib/i18n/candidate'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => intent(request, candidate.id))
}

async function intent(request: Request, candidateId: string) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string
    answer?: string
    intentId?: string
    groups?: { label?: unknown; values?: unknown }[]
  }

  if (body.action === 'confirm') {
    if (!body.intentId) {
      return NextResponse.json({ error: 'An intent id is required.' }, { status: 400 })
    }
    // What they left on the screen, edits included.
    const groups = Array.isArray(body.groups)
      ? body.groups.slice(0, 12).map((group) => ({
          label: typeof group.label === 'string' ? group.label.slice(0, 80) : '',
          values: (Array.isArray(group.values) ? group.values : []).filter((value): value is string => typeof value === 'string').map((value) => value.slice(0, 200)).slice(0, 12),
        }))
      : undefined
    if (!confirmLatestIntent(candidateId, body.intentId, groups)) {
      return NextResponse.json({ error: 'Intent not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  }

  const answer = body.answer?.trim()
  if (!answer) {
    return NextResponse.json({ error: 'An answer is required.' }, { status: 400 })
  }

  try {
    const result = await interpretIntent(candidateId, answer)
    refreshDetectedLocale(candidateId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ModelNotConfiguredError) {
      return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
    }
    if (error instanceof ModelError) {
      return NextResponse.json({ error: serverText().modelUnavailable, detail: error.message }, { status: 502 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Your intent could not be interpreted.' },
      { status: 500 },
    )
  }
}
