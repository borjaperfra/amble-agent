import { NextResponse } from 'next/server'
import { getSttConfig, isUserZero } from '@/lib/features'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Same shape as the model client: a dropped connection is worth another go. */
const ATTEMPTS = 3
const BACKOFF_MS = 1500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Speech to text for the interview answers.
 *
 * The audio is forwarded to the transcriber and nothing is kept: the point of
 * a voice answer is the words, and holding on to a recording of somebody
 * talking about their work is a liability nobody asked for.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const config = getSttConfig()
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Voice isn't configured. Set AMBLE_STT_MODEL (see .env.example) and restart the server.",
        unconfigured: true,
      },
      { status: 503 },
    )
  }

  const form = await request.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'No audio arrived.' }, { status: 400 })
  }
  if (audio.size > config.maxBytes) {
    return NextResponse.json(
      {
        error: `That recording is ${Math.round(audio.size / 1024 / 1024)}MB, past what the transcriber takes. Say it in two shorter goes.`,
      },
      { status: 413 },
    )
  }

  let lastError = 'The transcriber could not be reached.'

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const upstream = new FormData()
    upstream.append('file', audio, audio.name || 'answer.webm')
    upstream.append('model', config.model)
    if (config.language) upstream.append('language', config.language)

    try {
      const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: upstream,
      })

      const raw = await response.text()
      if (!response.ok) {
        // 524 is the endpoint giving up on a long recording; retrying the same
        // audio will fail the same way, so say what to do instead.
        if (response.status === 524) {
          return NextResponse.json(
            { error: 'That was too long for the transcriber. Try it in two shorter goes.' },
            { status: 413 },
          )
        }
        if (response.status >= 500 || response.status === 429) {
          lastError = `The transcriber returned HTTP ${response.status}.`
          if (attempt < ATTEMPTS) {
            await sleep(BACKOFF_MS * attempt)
            continue
          }
        }
        return NextResponse.json(
          { error: `The transcriber returned an error (HTTP ${response.status}).` },
          { status: 502 },
        )
      }

      let text = ''
      try {
        const body = JSON.parse(raw) as { text?: string }
        text = typeof body.text === 'string' ? body.text.trim() : ''
      } catch {
        // Some transcribers answer with plain text rather than JSON.
        text = raw.trim()
      }

      if (!text) {
        return NextResponse.json(
          { error: "I couldn't hear anything in that. Try again, or type it." },
          { status: 422 },
        )
      }

      return NextResponse.json({ text })
    } catch (error) {
      const cause = (error as { cause?: { code?: string } })?.cause
      lastError = `The transcriber could not be reached${cause?.code ? ` (${cause.code})` : ''}.`
      if (attempt < ATTEMPTS) await sleep(BACKOFF_MS * attempt)
    }
  }

  return NextResponse.json({ error: lastError }, { status: 502 })
}
