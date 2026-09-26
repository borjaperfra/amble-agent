import { NextResponse } from 'next/server'
import { isUserZero, ModelNotConfiguredError } from '@/lib/features'
import { ModelError } from '@/lib/model/provider'
import { buildCareerMarkdown, NoEvidenceError } from '@/lib/career/build'

export const runtime = 'nodejs'

// GET  -> the rendered career.md as text, for downloading or diffing
// POST -> the same build, returning stats as JSON
async function build() {
  return buildCareerMarkdown()
}

function errorResponse(error: unknown) {
  if (error instanceof ModelNotConfiguredError) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }
  if (error instanceof NoEvidenceError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof ModelError) {
    return NextResponse.json({ error: error.message, detail: error.detail ?? null }, { status: 502 })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Unknown error building career.md' },
    { status: 500 },
  )
}

export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  try {
    const result = await build()
    return new NextResponse(result.markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'inline; filename="career.md"',
        'X-Amble-Statements-Kept': String(result.stats.statementsKept),
        'X-Amble-Statements-Dropped': String(result.stats.statementsDropped),
        'X-Amble-Completeness': String(result.stats.completeness),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  try {
    const result = await build()
    return NextResponse.json({
      ok: true,
      stats: result.stats,
      modelRunId: result.modelRunId,
      storedPath: result.storedPath,
      markdown: result.markdown,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
