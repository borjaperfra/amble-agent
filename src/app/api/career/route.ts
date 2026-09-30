import { NextResponse } from 'next/server'
import { failure, forCandidate } from '@/lib/auth/request'
import { buildCareerMarkdown, getStoredCareer, listStoredCareerVersions, NoEvidenceError } from '@/lib/career/build'

export const runtime = 'nodejs'

// GET                 -> the latest stored career.md, as text
// GET ?version=N      -> a specific stored version, as text
// GET ?versions       -> the version history, as JSON
// POST                -> synthesize and store a new version (a model call)
//
// Reading never synthesizes. A version is what the system said at a point in
// time; regenerating on read would silently replace it.

function errorResponse(error: unknown) {
  if (error instanceof NoEvidenceError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  return failure('career.md', error)
}

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => readCareer(request, candidate.id))
}

function readCareer(request: Request, candidateId: string) {
  const params = new URL(request.url).searchParams

  if (params.has('versions')) {
    return NextResponse.json({ versions: listStoredCareerVersions(candidateId) })
  }

  const rawVersion = params.get('version')
  const version = rawVersion === null ? undefined : Number.parseInt(rawVersion, 10)
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    return NextResponse.json({ error: 'version must be a positive integer.' }, { status: 400 })
  }

  const stored = getStoredCareer(candidateId, version)
  if (!stored) {
    return NextResponse.json(
      {
        error:
          version === undefined
            ? 'No career.md has been generated yet. POST to this route to generate one.'
            : `There is no version ${version}.`,
      },
      { status: 404 },
    )
  }

  return new NextResponse(stored.markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="career.v${stored.version}.md"`,
      'X-Amble-Version': String(stored.version),
      'X-Amble-Generated-At': stored.createdAt,
      'X-Amble-Statements-Kept': String(stored.stats.statementsKept),
      'X-Amble-Statements-Dropped': String(stored.stats.statementsDropped),
      'X-Amble-Completeness': String(stored.stats.completeness),
    },
  })
}

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => writeCareer(candidate.id))
}

async function writeCareer(candidateId: string) {
  try {
    const result = await buildCareerMarkdown(candidateId)
    return NextResponse.json({
      ok: true,
      version: result.version,
      createdAt: result.createdAt,
      stats: result.stats,
      modelRunId: result.modelRunId,
      markdown: result.markdown,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
