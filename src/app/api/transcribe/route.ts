import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { sttConfigured, transcribeAudio, TranscriptionError } from '@/lib/model/transcribe'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Speech to text for the interview answers.
 *
 * The work itself lives in `lib/model/transcribe` now: a voice note sent to
 * the bot has to take the same path as one recorded on the screen, and a
 * route cannot be called from the queue.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  if (!sttConfigured()) {
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

  try {
    const text = await transcribeAudio(audio, audio.name || 'answer.webm')
    return NextResponse.json({ text })
  } catch (error) {
    if (error instanceof TranscriptionError) {
      // Lo que no se arregla repitiendo se cuenta tal cual; lo que sí, 502,
      // que es lo que la pantalla sabe reintentar.
      return NextResponse.json({ error: error.message }, { status: error.permanent ? 413 : 502 })
    }
    return NextResponse.json({ error: 'The transcriber could not be reached.' }, { status: 502 })
  }
}
