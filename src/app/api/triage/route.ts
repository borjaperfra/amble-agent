import { NextResponse } from 'next/server'
import { isUserZero, ModelNotConfiguredError } from '@/lib/features'
import { ModelError } from '@/lib/model/provider'
import {
  analyseTriage,
  answerProbe,
  createTriage,
  createTriageInputSchema,
  decidePreference,
  getTriageView,
  TriageError,
} from '@/lib/pipeline/triage'

export const runtime = 'nodejs'
export const maxDuration = 300

// GET                                   -> the latest triage (axes hidden until analysed)
// POST { action: 'create', ...triage }  -> a new triage from given offers
// POST { action: 'answer', probeId, verdict, conditions?, reason? }
// POST { action: 'analyse' }            -> propose revealed preferences (a model call)
// POST { action: 'decide', preferenceId, decision: 'confirmed' | 'rejected' }

function errorResponse(error: unknown) {
  if (error instanceof TriageError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof ModelNotConfiguredError) {
    return NextResponse.json({ error: error.message, unconfigured: true }, { status: 503 })
  }
  if (error instanceof ModelError) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'The triage request failed.' },
    { status: 500 },
  )
}

export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const triage = getTriageView()
  if (!triage) return NextResponse.json({ error: 'There is no triage yet.' }, { status: 404 })
  return NextResponse.json(triage)
}

export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    switch (body.action) {
      case 'create': {
        const parsed = createTriageInputSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid triage.', issues: parsed.error.issues }, { status: 400 })
        }
        const triage = createTriage(parsed.data)
        return NextResponse.json(getTriageView(triage.id), { status: 201 })
      }
      case 'answer': {
        answerProbe({
          probeId: String(body.probeId ?? ''),
          verdict: String(body.verdict ?? ''),
          conditions: typeof body.conditions === 'string' ? body.conditions : null,
          reason: typeof body.reason === 'string' ? body.reason : null,
        })
        return NextResponse.json({ ok: true })
      }
      case 'analyse': {
        const result = await analyseTriage()
        return NextResponse.json({ ...result, triage: getTriageView() })
      }
      case 'decide': {
        decidePreference(String(body.preferenceId ?? ''), String(body.decision ?? ''))
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: 'action must be create, answer, analyse or decide.' }, { status: 400 })
    }
  } catch (error) {
    return errorResponse(error)
  }
}
