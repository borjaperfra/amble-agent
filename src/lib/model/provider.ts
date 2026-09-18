import type { ZodType } from 'zod'
import { getModelConfig, ModelNotConfiguredError, type ModelConfig, type ReasoningEffort } from '../features'
import { insertModelRun, newId } from '../db/repo'

export class ModelError extends Error {
  status?: number
  detail?: string
  /** A dropped connection or an overloaded server is worth another go. */
  retryable: boolean

  constructor(
    message: string,
    options?: { status?: number; detail?: string; retryable?: boolean },
  ) {
    super(message)
    this.name = 'ModelError'
    this.status = options?.status
    this.detail = options?.detail
    this.retryable = options?.retryable ?? false
  }
}

/** A bad answer is worth one more shot. */
const MAX_CONTENT_ATTEMPTS = 2
/** A dropped connection is worth two. */
const MAX_TRANSPORT_ATTEMPTS = 3
const TRANSPORT_BACKOFF_MS = 2500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  /**
   * How hard the model should think about this particular task. Only sent
   * when reasoning is enabled in the config, since non-reasoning models
   * reject the parameter.
   */
  reasoningEffort?: ReasoningEffort
}

interface ChatCompletionResponse {
  choices?: {
    finish_reason?: string
    message?: { content?: string; reasoning_content?: string }
  }[]
  error?: { message?: string }
}

interface CompletionResult {
  content: string
  reasoningContent: string | null
  finishReason: string | null
  latencyMs: number
}

/**
 * Pull the JSON object out of a model reply.
 *
 * Without server-side JSON mode a model may wrap the object in prose, in a
 * code fence, or in a thinking block. The object itself is still in there, so
 * we scan for the first balanced one rather than giving up on the whole reply.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

function parseModelJson(raw: string): unknown {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ').trim()
  const fenced = withoutThinking.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = (fenced ? fenced[1] : withoutThinking).trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const extracted = extractJsonObject(candidate)
    if (extracted === null) throw new SyntaxError('No JSON object found in the response.')
    return JSON.parse(extracted)
  }
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
  config: ModelConfig,
  system: string,
  user: string,
  temperature: number,
  reasoningEffort: ReasoningEffort | undefined,
): Promise<CompletionResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  const startedAt = Date.now()

  const payload: Record<string, unknown> = {
    model: config.modelId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
  }
  if (config.jsonMode) payload.response_format = { type: 'json_object' }
  if (config.reasoning) payload.reasoning_effort = reasoningEffort ?? config.reasoningEffort
  if (config.maxTokens !== null) payload.max_tokens = config.maxTokens

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt
    const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null
    if (!response.ok) {
      throw new ModelError(`The model returned an error (HTTP ${response.status}).`, {
        status: response.status,
        detail: body?.error?.message ?? undefined,
        // Rate limiting and server-side trouble pass; a rejected key does not.
        retryable: response.status === 429 || response.status >= 500,
      })
    }
    const choice = body?.choices?.[0]
    const content = choice?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new ModelError('The model returned an empty response.')
    }
    return {
      content,
      reasoningContent: choice?.message?.reasoning_content ?? null,
      finishReason: choice?.finish_reason ?? null,
      latencyMs,
    }
  } catch (error) {
    if (error instanceof ModelError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ModelError(
        `The model took longer than ${Math.round(config.timeoutMs / 1000)}s to respond.`,
      )
    }
    // Reaching it failed rather than answering badly: the connection was reset,
    // DNS blinked, the socket closed mid-read. That is worth trying again.
    //
    // fetch() says only "fetch failed"; the code underneath says whether it was
    // a reset, a refused connection or a name that would not resolve, which is
    // the difference between an upstream blip and a broken setup.
    const cause = (error as { cause?: { code?: string; message?: string } })?.cause
    const because = cause?.code ?? cause?.message
    throw new ModelError(
      error instanceof Error
        ? `Could not reach the model: ${error.message}${because ? ` (${because})` : ''}`
        : 'Could not reach the model.',
      { retryable: true, detail: because ?? (error instanceof Error ? error.message : undefined) },
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function runStructuredTask<T>(options: StructuredTaskOptions<T>): Promise<StructuredRun<T>> {
  const config = getModelConfig()
  if (!config) throw new ModelNotConfiguredError()

  const { candidateId, task, version, system, user, schema } = options
  const temperature = options.temperature ?? 0.2

  let lastError: ModelError | null = null
  // Set only after the model answered badly, never after a failed connection:
  // there is no previous response to hold against it.
  let nudge: string | null = null
  let contentAttempts = 0
  let transportAttempts = 0

  for (;;) {
    const runId = newId('run')
    const attemptUser =
      nudge === null
        ? user
        : `${user}\n\nIMPORTANT: your previous response failed validation: ${nudge}. Respond again with JSON that strictly satisfies the schema. Output the JSON object and nothing else.`

    const record = (
      ok: 0 | 1,
      error: string | null,
      result: Partial<CompletionResult> & { content?: string },
    ) =>
      insertModelRun({
        id: runId,
        candidate_id: candidateId,
        task,
        task_version: version,
        provider: config.provider,
        model_id: config.modelId,
        base_url: config.baseUrl,
        prompt_chars: attemptUser.length,
        output_chars: result.content?.length ?? 0,
        latency_ms: result.latencyMs ?? null,
        ok,
        error,
        raw_output: result.content ? result.content.slice(0, 8000) : null,
        reasoning_output: result.reasoningContent ? result.reasoningContent.slice(0, 8000) : null,
      })

    let completion: CompletionResult
    try {
      completion = await callChatCompletion(
        config,
        system,
        attemptUser,
        temperature,
        options.reasoningEffort,
      )
    } catch (error) {
      if (error instanceof ModelNotConfiguredError) throw error
      const modelError =
        error instanceof ModelError
          ? error
          : new ModelError(error instanceof Error ? error.message : 'Unknown model error')
      record(0, modelError.message, {})
      transportAttempts++
      if (!modelError.retryable || transportAttempts >= MAX_TRANSPORT_ATTEMPTS) throw modelError
      lastError = modelError
      await sleep(TRANSPORT_BACKOFF_MS * transportAttempts)
      continue
    }

    contentAttempts++
    const contentExhausted = contentAttempts >= MAX_CONTENT_ATTEMPTS

    if (completion.finishReason === 'length') {
      record(0, 'Response truncated: hit the token limit before the JSON was complete.', completion)
      lastError = new ModelError(
        'The model ran out of room before finishing its answer. Raise AMBLE_MODEL_MAX_TOKENS.',
        { detail: 'truncated_output' },
      )
      nudge = 'truncated_output'
      if (contentExhausted) break
      continue
    }

    let parsed: unknown
    try {
      parsed = parseModelJson(completion.content)
    } catch {
      record(0, 'Invalid JSON in model response', completion)
      lastError = new ModelError('The model returned invalid JSON.', { detail: 'json_parse' })
      nudge = 'json_parse'
      if (contentExhausted) break
      continue
    }

    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      const issues = formatSchemaIssues(validated.error.issues)
      record(0, `Schema validation failed: ${issues}`, completion)
      lastError = new ModelError('The model response did not match the expected schema.', {
        detail: issues,
      })
      nudge = issues
      if (contentExhausted) break
      continue
    }

    record(1, null, completion)
    return { data: validated.data, modelRunId: runId, latencyMs: completion.latencyMs }
  }

  throw lastError ?? new ModelError('The model failed after repeated attempts.')
}
