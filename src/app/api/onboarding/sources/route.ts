import { NextResponse } from 'next/server'
import { failure, forCandidate, textField } from '@/lib/auth/request'
import { listSources, type CandidateRow } from '@/lib/db/repo'
import {
  createFileSource,
  createGitHubSource,
  createLinkedInSource,
  createWebsiteSource,
  MAX_PDF_BYTES,
  removeSource,
  type SourceCreated,
} from '@/lib/pipeline/sources'
import { serverText } from '@/lib/i18n/candidate'
import { takeIntake } from '@/lib/limits'

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
    // Uploaded, not an address: which place on the screen it fills.
    file: source.original_filename !== null,
  }))
  return NextResponse.json(sources)
}

export async function POST(request: Request) {
  return forCandidate(request, (candidate) => addSource(request, candidate))
}

async function addSource(request: Request, candidate: CandidateRow) {
  const contentType = request.headers.get('content-type') ?? ''

  // Before anything is read: enough sources, or enough tries for today.
  const refused = takeIntake(candidate.id, 'source')
  if (refused) {
    return NextResponse.json({ error: refused === 'too_many_sources' ? serverText().tooManySources : serverText().tooManyToday }, { status: 429 })
  }

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
      const body = (await request.json().catch(() => null)) as { kind?: unknown; url?: unknown } | null
      const url = textField(body?.url, 2048)?.trim()
      if (!body || !url) {
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
    return failure('source', error)
  }
}

// DELETE ?id=<source> -> taken back while setting up (the wrong file, a typo).
// Not once it has been read into their map.
export async function DELETE(request: Request) {
  return forCandidate(request, (candidate) => {
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!removeSource(candidate.id, id)) return NextResponse.json({ error: 'not_removable' }, { status: 409 })
    return sourcesOf(candidate)
  })
}
