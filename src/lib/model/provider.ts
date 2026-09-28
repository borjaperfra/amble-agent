import type { ZodType } from 'zod'
import { getModelConfig, ModelNotConfiguredError } from '../features'
import { getCandidate, insertModelRun, newId } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { LANGUAGE_NAME, type Locale } from '../i18n/locale'

export class ModelError extends Error {
  status?: number
  detail?: string

  constructor(message: string, options?: { status?: number; detail?: string }) {
    super(message)
    this.name = 'ModelError'
    this.status = options?.status
    this.detail = options?.detail
  }
}

export interface StructuredRun<T> {
  data: T
  modelRunId: string
  latencyMs: number
}

export interface StructuredTaskOptions<T> {
  candidateId: string | null
  task: string
  version: string
  system: string
  user: string
  schema: ZodType<T>
  temperature?: number
  // Language for every human-readable value the model writes. Defaults to the
  // candidate's; null means the task writes nothing a person reads.
  language?: Locale | null
}

// One instruction for every task, instead of each prompt naming a language.
// Quotes are the exception: domain rules check them character by character
// against the source or the candidate's words, so a translated quote is a
// fabricated one.
function languageInstruction(language: Locale): string {
  return `

OUTPUT LANGUAGE: write every human-readable value (sentences, names, labels, questions, reasons, descriptions) in ${LANGUAGE_NAME[language]}. JSON keys and enum values stay exactly as specified. Verbatim quotes and excerpts from sources or from the candidate stay in their original language, character for character: never translate a quote. Never assume the candidate's gender: when addressing or describing them, use phrasing that does not mark it. The product's name is written amble, always lowercase, even at the start of a sentence.`
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

function formatSchemaIssues(
  issues: readonly { path: readonly (string | number | symbol)[]; message: string }[],
): string {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

async function callChatCompletion(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  system: string,
  user: string,
  temperature: number,
): Promise<{ content: string; latencyMs: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const startedAt = Date.now()
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt
    const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null
    if (!response.ok) {
      throw new ModelError(`The model returned an error (HTTP ${response.status}).`, {
        status: response.status,
        detail: body?.error?.message ?? undefined,
      })
    }
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new ModelError('The model returned an empty response.')
    }
    return { content, latencyMs }
  } catch (error) {
    if (error instanceof ModelError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ModelError('The model took too long to respond.')
    }
    throw new ModelError(
      error instanceof Error ? `Could not reach the model: ${error.message}` : 'Could not reach the model.',
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function runStructuredTask<T>(options: StructuredTaskOptions<T>): Promise<StructuredRun<T>> {
  const config = getModelConfig()
  if (!config) throw new ModelNotConfiguredError()

  const { candidateId, task, schema, user } = options
  const language =
    options.language === undefined ? (candidateId ? candidateLocale(getCandidate(candidateId) ?? null) : null) : options.language
  const system = language ? options.system + languageInstruction(language) : options.system
  const version = language ? `${options.version}@${language}` : options.version
  const temperature = options.temperature ?? 0.2

  let lastError: ModelError | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    const runId = newId('run')
    const attemptUser =
      attempt === 1
        ? user
        : `${user}\n\nIMPORTANT: your previous response failed validation: ${lastError?.detail ?? 'unknown issue'}. Respond again with JSON that strictly satisfies the schema.`
    try {
      const { content, latencyMs } = await callChatCompletion(
        config.baseUrl,
        config.apiKey,
        config.modelId,
        system,
        attemptUser,
        temperature,
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(stripCodeFences(content))
      } catch {
        insertModelRun({
          id: runId,
          candidate_id: candidateId,
          task,
          task_version: version,
          provider: config.provider,
          model_id: config.modelId,
          base_url: config.baseUrl,
          prompt_chars: attemptUser.length,
          output_chars: content.length,
          latency_ms: latencyMs,
          ok: 0,
          error: 'Invalid JSON in model response',
          raw_output: content.slice(0, 8000),
        })
        throw new ModelError('The model returned invalid JSON.', { detail: 'json_parse' })
      }
      const validated = schema.safeParse(parsed)
      if (!validated.success) {
        insertModelRun({
          id: runId,
          candidate_id: candidateId,
          task,
          task_version: version,
          provider: config.provider,
          model_id: config.modelId,
          base_url: config.baseUrl,
          prompt_chars: attemptUser.length,
          output_chars: content.length,
          latency_ms: latencyMs,
          ok: 0,
          error: `Schema validation failed: ${formatSchemaIssues(validated.error.issues)}`,
          raw_output: content.slice(0, 8000),
        })
        lastError = new ModelError('The model response did not match the expected schema.', {
          detail: formatSchemaIssues(validated.error.issues),
        })
        continue
      }
      insertModelRun({
        id: runId,
        candidate_id: candidateId,
        task,
        task_version: version,
        provider: config.provider,
        model_id: config.modelId,
        base_url: config.baseUrl,
        prompt_chars: attemptUser.length,
        output_chars: content.length,
        latency_ms: latencyMs,
        ok: 1,
        error: null,
        raw_output: content.slice(0, 8000),
      })
      return { data: validated.data, modelRunId: runId, latencyMs }
    } catch (error) {
      const modelError =
        error instanceof ModelError
          ? error
          : new ModelError(error instanceof Error ? error.message : 'Unknown model error')
      if (error instanceof ModelNotConfiguredError) throw error
      if (!(error instanceof ModelError)) throw modelError
      lastError = modelError
      // Invalid JSON was already recorded under this run id inside the try, and
      // deserves the retry. Anything else (HTTP, network, timeout) is recorded
      // here and ends the task.
      if (modelError.detail !== 'json_parse') {
        insertModelRun({
          id: runId,
          candidate_id: candidateId,
          task,
          task_version: version,
          provider: config.provider,
          model_id: config.modelId,
          base_url: config.baseUrl,
          prompt_chars: attemptUser.length,
          output_chars: 0,
          latency_ms: null,
          ok: 0,
          error: modelError.message,
          raw_output: null,
        })
        throw modelError
      }
    }
  }

  throw lastError ?? new ModelError('The model failed after repeated attempts.')
}
