import { NextResponse } from 'next/server'
import { ModelNotConfiguredError } from '@/lib/features'
import { ModelError } from '@/lib/model/provider'
import {
  analyseTriage,
  answerProbe,
  createTriage,
  createTriageInputSchema,
  addPreference,
  decidePreference,
  generateTriage,
  getTriageView,
  revisePreference,
  TriageError,
} from '@/lib/pipeline/triage'

export const runtime = 'nodejs'
export const maxDuration = 300

// GET                                   -> the latest triage (axes hidden until analysed)
// POST { action: 'create', ...triage }  -> a new triage from given offers
// POST { action: 'generate' }           -> a new triage designed by the Rep (a model call)
// POST { action: 'answer', probeId, verdict, conditions?, reason? }
// POST { action: 'analyse' }            -> propose revealed preferences (a model call)
// POST { action: 'decide', preferenceId, decision: 'confirmed' | 'rejected' }
// POST { action: 'revise', preferenceId, statement, label? }      -> the candidate's correction
// POST { action: 'add', kind, statement, label?, offers?, quote? } -> something the analysis missed| 'rejected' }

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
  const triage = getTriageView()
  if (!triage) return NextResponse.json({ error: 'There is no triage yet.' }, { status: 404 })
  return NextResponse.json(triage)
}

export async function POST(request: Request) {
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
      case 'generate': {
        const triage = await generateTriage()
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
      case 'revise': {
        revisePreference(
          String(body.preferenceId ?? ''),
          String(body.statement ?? ''),
          typeof body.label === 'string' ? body.label : null,
        )
        return NextResponse.json({ ok: true })
      }
      case 'add': {
        const preference = addPreference({
          kind: String(body.kind ?? ''),
          statement: String(body.statement ?? ''),
          label: typeof body.label === 'string' ? body.label : null,
          offerNumbers: Array.isArray(body.offers) ? body.offers.filter((n): n is number => typeof n === 'number') : [],
          quote: typeof body.quote === 'string' ? body.quote : null,
        })
        return NextResponse.json({ ok: true, id: preference.id }, { status: 201 })
      }
      default:
        return NextResponse.json(
          { error: 'action must be create, generate, answer, analyse, decide, revise or add.' },
          { status: 400 },
        )
    }
  } catch (error) {
    return errorResponse(error)
  }
}
