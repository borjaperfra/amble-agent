import { NextResponse } from 'next/server'
import { applicationCv, CvRejectedError, storeApplicationCv } from '@/lib/apply/answers'
import { forCandidate } from '@/lib/auth/request'

export const runtime = 'nodejs'

// GET                  -> the CV the candidate sends with applications, if any
// POST multipart file  -> a new one, kept as they gave it

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => {
    const cv = applicationCv(candidate.id)
    return NextResponse.json(cv ? { filename: cv.filename, createdAt: cv.created_at } : null)
  })
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file was provided.' }, { status: 400 })
    try {
      const cv = await storeApplicationCv(candidate.id, file)
      return NextResponse.json({ filename: cv.filename, createdAt: cv.created_at })
    } catch (error) {
      if (error instanceof CvRejectedError) return NextResponse.json({ error: error.message }, { status: 400 })
      throw error
    }
  })
}
