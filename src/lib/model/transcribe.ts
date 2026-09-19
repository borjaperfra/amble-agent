/**
 * Voz a texto.
 *
 * Estaba dentro de la ruta que usa la entrevista, que valía mientras el
 * único sitio desde donde se hablaba era el navegador. Ahora también llegan
 * notas de voz por Telegram, y un audio grabado en el sofá tiene que entrar
 * por el mismo sitio que uno grabado en la pantalla.
 *
 * No se guarda nada: lo que importa de una respuesta hablada son las
 * palabras, y quedarse con la grabación de alguien contando su trabajo es un
 * problema que nadie ha pedido.
 */

import { getSttConfig, type SttConfig } from '@/lib/features'

/** Igual que el cliente del modelo: una conexión caída merece otro intento. */
const ATTEMPTS = 3
const BACKOFF_MS = 1500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class TranscriptionError extends Error {
  /** Reintentar el mismo audio daría el mismo resultado. */
  readonly permanent: boolean

  constructor(message: string, permanent = false) {
    super(message)
    this.name = 'TranscriptionError'
    this.permanent = permanent
  }
}

export function sttConfigured(): boolean {
  return getSttConfig() !== null
}

/**
 * Las palabras que hay en ese audio, o un error que dice qué hacer.
 *
 * Los mensajes son para leerlos: quien grabó treinta segundos y no ve nada
 * necesita saber si fue el audio, el tamaño o que no hay transcriptor.
 */
export async function transcribeAudio(
  audio: Blob,
  filename = 'answer.webm',
  config: SttConfig | null = getSttConfig(),
): Promise<string> {
  if (!config) {
    throw new TranscriptionError(
      'Voice is not configured. Set AMBLE_STT_MODEL (see .env.example).',
      true,
    )
  }
  if (audio.size === 0) throw new TranscriptionError('No audio arrived.', true)
  if (audio.size > config.maxBytes) {
    throw new TranscriptionError(
      `That recording is ${Math.round(audio.size / 1024 / 1024)}MB, past what the transcriber takes. Say it in two shorter goes.`,
      true,
    )
  }

  let lastError = 'The transcriber could not be reached.'

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const upstream = new FormData()
    upstream.append('file', audio, filename)
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
        // 524 es el endpoint rindiéndose con un audio largo: el mismo audio
        // va a fallar igual, así que se dice qué hacer en vez de reintentar.
        if (response.status === 524) {
          throw new TranscriptionError(
            'That was too long for the transcriber. Try it in two shorter goes.',
            true,
          )
        }
        if (response.status >= 500 || response.status === 429) {
          lastError = `The transcriber returned HTTP ${response.status}.`
          if (attempt < ATTEMPTS) {
            await sleep(BACKOFF_MS * attempt)
            continue
          }
        }
        throw new TranscriptionError(
          `The transcriber returned an error (HTTP ${response.status}).`,
          response.status < 500,
        )
      }

      let text = ''
      try {
        const body = JSON.parse(raw) as { text?: string }
        text = typeof body.text === 'string' ? body.text.trim() : ''
      } catch {
        // Algunos transcriptores contestan texto plano en vez de JSON.
        text = raw.trim()
      }

      if (!text) {
        throw new TranscriptionError("I couldn't hear anything in that.", true)
      }
      return text
    } catch (error) {
      if (error instanceof TranscriptionError) throw error
      const cause = (error as { cause?: { code?: string } })?.cause
      lastError = `The transcriber could not be reached${cause?.code ? ` (${cause.code})` : ''}.`
      if (attempt < ATTEMPTS) await sleep(BACKOFF_MS * attempt)
    }
  }

  throw new TranscriptionError(lastError)
}
