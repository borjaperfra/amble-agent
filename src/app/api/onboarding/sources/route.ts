import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { listSources, type CandidateRow } from '@/lib/db/repo'
import {
  createFileSource,
  createGitHubSource,
  createLinkedInSource,
  createWebsiteSource,
  MAX_PDF_BYTES,
  type SourceCreated,
} from '@/lib/pipeline/sources'
import { serverText } from '@/lib/i18n/candidate'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => sourcesOf(candidate))
}

function sourcesOf(candidate: CandidateRow) {
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
  return forCandidate(request, (candidate) => addSource(request, candidate))
}

async function addSource(request: Request, candidate: CandidateRow) {
  const contentType = request.headers.get('content-type') ?? ''

  try {
    let result: SourceCreated
    if (contentType.includes('multipart/form-data')) {
      // Refused before it is read into memory, not after.
      if (Number(request.headers.get('content-length') ?? 0) > MAX_PDF_BYTES + 64 * 1024) {
        return NextResponse.json({ error: serverText().fileTooLarge }, { status: 413 })
      }
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
