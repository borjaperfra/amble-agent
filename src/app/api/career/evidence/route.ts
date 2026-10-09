import { NextResponse } from 'next/server'
import { forCandidate, textField } from '@/lib/auth/request'
import { listCapabilities } from '@/lib/db/repo'
import { refreshDetectedLocale } from '@/lib/i18n/candidate'
import { refreshDerivedProfile } from '@/lib/pipeline/graph'
import { parseGitHubHandle } from '@/lib/pipeline/github'
import { takeMapNote } from '@/lib/pipeline/interview'
import { readLaterSource } from '@/lib/pipeline/setup'
import { createGitHubSource, createWebsiteSource } from '@/lib/pipeline/sources'

export const runtime = 'nodejs'
export const maxDuration = 60

// Proof of one capability, brought from the map without waiting for a
// question (#24): what they write is taken in as something they told about
// that capability, and a link in it (their site, a repository, something
// they wrote) is read into their map as a document is. Both in the
// background: the map shows it when it is in.

const MAX_TEXT = 4000
const MAX_LINKS = 2
// Fewer words than this, around the links, say nothing to take in.
const MIN_WORDS_CHARS = 12
const LINK = /https?:\/\/[^\s<>"')]+/gi

export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const body = (await request.json().catch(() => ({}))) as { capabilityId?: unknown; text?: unknown }
    const capabilityId = textField(body.capabilityId, 120)
    const text = textField(body.text, MAX_TEXT)?.trim()
    if (!capabilityId || !text) return NextResponse.json({ error: 'A capability and some text are required.' }, { status: 400 })
    const capability = listCapabilities(candidate.id).find((item) => item.id === capabilityId)
    if (!capability) return NextResponse.json({ error: 'Capability not found.' }, { status: 404 })

    const links = [...new Set(text.match(LINK) ?? [])].slice(0, MAX_LINKS)
    const problems: string[] = []
    let reading = 0
    for (const link of links) {
      const created = parseGitHubHandle(link) ? await createGitHubSource(candidate.id, link) : await createWebsiteSource(candidate.id, link)
      if (created.status === 'extracted') {
        reading++
        void readLaterSource(candidate.id, created.id).catch((error) =>
          console.error('[amble] map evidence link not read:', error instanceof Error ? error.message : error),
        )
      } else if (created.detail) {
        problems.push(created.detail)
      }
    }

    const words = text.replace(LINK, ' ').replace(/\s+/g, ' ').trim()
    const note = words.length >= MIN_WORDS_CHARS
    if (note) {
      takeMapNote(candidate.id, capability, text, async (result) => {
        refreshDetectedLocale(candidate.id)
        if (result.profileNeedsRefresh) await refreshDerivedProfile(candidate.id)
      })
    }
    if (!note && reading === 0) return NextResponse.json({ error: problems[0] ?? null, ok: false }, { status: 422 })
    return NextResponse.json({ ok: true, note, reading, problems })
  })
}
