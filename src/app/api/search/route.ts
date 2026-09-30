import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { isSearchPaused, pauseSearch, resumeSearch } from '@/lib/pause'

export const runtime = 'nodejs'

// GET                         -> { paused }
// POST { action: 'pause' }    -> the search paused until further notice
// POST { action: 'resume' }   -> running again
export async function GET(request: Request) {
  return forCandidate(request, (candidate) => NextResponse.json({ paused: isSearchPaused(candidate.id) }))
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown }
    if (body.action === 'pause') pauseSearch(candidate.id)
    else if (body.action === 'resume') resumeSearch(candidate.id)
    else return NextResponse.json({ error: 'action must be pause or resume.' }, { status: 400 })
    return NextResponse.json({ paused: isSearchPaused(candidate.id) })
  })
}
