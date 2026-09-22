import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate, listSources } from '@/lib/db/repo'
import {
  createFileSource,
  createGitHubSource,
  createLinkedInSource,
  createWebsiteSource,
  type SourceCreated,
} from '@/lib/pipeline/sources'

export const runtime = 'nodejs'

function guard(): NextResponse | null {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  return null
}

export async function GET() {
  const blocked = guard()
  if (blocked) return blocked
  const candidate = getOrCreateCandidate()
  const sources = listSources(candidate.id).map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    detail: source.status_detail,
  }))
  return NextResponse.json(sources)
}

export async function POST(request: Request) {
  const blocked = guard()
  if (blocked) return blocked

  const candidate = getOrCreateCandidate()
  const contentType = request.headers.get('content-type') ?? ''

  try {
    let result: SourceCreated
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file was provided.' }, { status: 400 })
      }
      result = await createFileSource(candidate.id, file)
    } else {
      const body = (await request.json()) as { kind?: string; url?: string }
      const url = body.url?.trim()
      if (!url) {
        return NextResponse.json({ error: 'No URL was provided.' }, { status: 400 })
      }
      if (body.kind === 'linkedin') {
        result = createLinkedInSource(candidate.id, url)
      } else if (body.kind === 'github') {
        result = await createGitHubSource(candidate.id, url)
      } else if (body.kind === 'website') {
        result = await createWebsiteSource(candidate.id, url)
      } else {
        return NextResponse.json({ error: 'Unknown source kind.' }, { status: 400 })
      }
    }
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The source could not be stored.' },
      { status: 500 },
    )
  }
}
