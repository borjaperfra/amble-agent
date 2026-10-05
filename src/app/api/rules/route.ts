import { NextResponse } from 'next/server'
import { failure, forCandidate } from '@/lib/auth/request'
import { requestReread } from '@/lib/matching/run'
import { addRule, changeRule, getRulesView, keepRule, removeRule, RuleError, setAbout } from '@/lib/pipeline/rules'

export const runtime = 'nodejs'

// GET                                   -> every rule the Rep applies, and what waits for their yes
// POST { action: 'change', id, text }   -> their words become the rule
// POST { action: 'remove', id }         -> no longer applied
// POST { action: 'keep', id }           -> a proposal accepted, or a stale rule still holding
// POST { action: 'add', group, text }   -> group: never | pay | weighs | notFor
// POST { action: 'about', homeCountry, languages: [{ code, level }] } -> where they live, what they work in

export async function GET(request: Request) {
  return forCandidate(request, (candidate) => NextResponse.json(getRulesView(candidate.id)))
}

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(body.id ?? '')
    const text = typeof body.text === 'string' ? body.text : ''
    try {
      switch (body.action) {
        case 'change':
          changeRule(candidate.id, id, text)
          break
        case 'remove':
          removeRule(candidate.id, id)
          break
        case 'keep':
          keepRule(candidate.id, id)
          break
        case 'about':
          setAbout(candidate.id, body.homeCountry, body.languages)
          break
        case 'add':
          addRule(candidate.id, String(body.group ?? ''), text)
          break
        default:
          return NextResponse.json({ error: 'action must be change, remove, keep, add or about.' }, { status: 400 })
      }
    } catch (error) {
      if (error instanceof RuleError) return NextResponse.json({ error: error.message }, { status: error.status })
      return failure('rules', error)
    }
    // Their rules changed: what was read lately is read again, in the background.
    requestReread(candidate.id)
    return NextResponse.json(getRulesView(candidate.id))
  })
}
