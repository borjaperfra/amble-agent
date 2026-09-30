import { NextResponse } from 'next/server'
import { confirmLatestIntent, interpretIntent } from '@/lib/pipeline/intent'
import { failure, forCandidate, textField } from '@/lib/auth/request'
import { refreshDetectedLocale } from '@/lib/i18n/candidate'
import { requestReread } from '@/lib/matching/run'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => intent(request, candidate.id))
}

async function intent(request: Request, candidateId: string) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown
    answer?: unknown
    intentId?: unknown
    groups?: { label?: unknown; values?: unknown }[]
  }

  if (body.action === 'confirm') {
    const intentId = textField(body.intentId, 64)
    if (!intentId) {
      return NextResponse.json({ error: 'An intent id is required.' }, { status: 400 })
    }
    // What they left on the screen, edits included.
    const groups = Array.isArray(body.groups)
      ? body.groups.slice(0, 12).map((group) => ({
          label: typeof group?.label === 'string' ? group.label.slice(0, 80) : '',
          values: (Array.isArray(group?.values) ? group.values : []).filter((value): value is string => typeof value === 'string').map((value) => value.slice(0, 200)).slice(0, 12),
        }))
      : undefined
    if (!confirmLatestIntent(candidateId, intentId, groups)) {
      return NextResponse.json({ error: 'Intent not found.' }, { status: 404 })
    }
    // What they want changed: what was read lately is read again, in the background.
    requestReread(candidateId)
    return NextResponse.json({ ok: true })
  }

  // What they look for, in their words: a few paragraphs at most.
  const answer = textField(body.answer, 8000)?.trim()
  if (!answer) {
    return NextResponse.json({ error: 'An answer is required.' }, { status: 400 })
  }

  try {
    const result = await interpretIntent(candidateId, answer)
    refreshDetectedLocale(candidateId)
    return NextResponse.json(result)
  } catch (error) {
    return failure('intent', error)
  }
}
