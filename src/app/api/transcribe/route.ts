import { NextResponse } from 'next/server'
import { forCandidate } from '@/lib/auth/request'
import { candidateLocale, serverText } from '@/lib/i18n/candidate'
import { MAX_AUDIO_BYTES, transcribe } from '@/lib/model/transcribe'

export const runtime = 'nodejs'
export const maxDuration = 120

// A spoken answer, as text for them to read over before sending. The audio
// is not kept.
export async function POST(request: Request) {
  return forCandidate(request, async (candidate) => {
    const form = await request.formData().catch(() => null)
    const audio = form?.get('audio')
    if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'No audio.' }, { status: 400 })
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: 'Too long.' }, { status: 413 })
    const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'
    try {
      const text = await transcribe(audio, `answer.${extension}`, candidateLocale(candidate))
      return NextResponse.json({ text })
    } catch {
      return NextResponse.json({ error: serverText().modelUnavailable }, { status: 502 })
    }
  })
}
