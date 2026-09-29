import { getModelConfig, ModelNotConfiguredError } from '../features'
import { ModelError } from './provider'

// Speech to text on the same provider as every other model call (Helmcode's
// whisper, OpenAI-compatible). About two minutes per request: the recorder
// stops there.

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export async function transcribe(audio: Blob, filename: string, language?: string): Promise<string> {
  const config = getModelConfig()
  if (!config) throw new ModelNotConfiguredError()
  const form = new FormData()
  form.append('model', process.env.AMBLE_TRANSCRIBE_MODEL?.trim() || 'whisper')
  form.append('file', audio, filename)
  if (language) form.append('language', language)
  form.append('response_format', 'json')
  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  })
  const body = (await response.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null
  if (!response.ok) {
    throw new ModelError(`Transcription failed (HTTP ${response.status}).`, { status: response.status, detail: body?.error?.message })
  }
  return (body?.text ?? '').trim()
}
