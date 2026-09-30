import type { ZodType } from 'zod'
import { getModelConfig, ModelNotConfiguredError } from '../features'
import { getCandidate, insertModelRun, newId } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { LANGUAGE_NAME, type Locale } from '../i18n/locale'

export class ModelError extends Error {
  status?: number
  detail?: string
  retryAfterMs?: number
  // The provider could not be reached (the connection refused or cut): as
  // passing as it being busy.
  unreachable?: boolean

  constructor(message: string, options?: { status?: number; detail?: string; retryAfterMs?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'ModelError'
    this.status = options?.status
    this.detail = options?.detail
    this.retryAfterMs = options?.retryAfterMs
    this.unreachable = options?.unreachable
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
  // Work nobody is waiting on (listening). It queues behind anything a person
  // is waiting for on the screen.
  background?: boolean
}

// Every model call in the process shares the provider's limit on requests in
// flight (Helmcode allows 10 per key on deepseek-v4-flash). Background work
// never takes the last few, so a person on the screen is not queued behind a
// listening pass.
const MODEL_CONCURRENCY = Math.max(1, Number(process.env.AMBLE_MODEL_CONCURRENCY) || 10)
const INTERACTIVE_RESERVE = Math.min(3, MODEL_CONCURRENCY - 1)
export const BACKGROUND_SLOTS = MODEL_CONCURRENCY - INTERACTIVE_RESERVE

interface Slots {
  active: number
  interactive: (() => void)[]
  background: (() => void)[]
  // After a 429 no call starts before this: the calls waiting would all be
  // refused too, and each refusal pushes the provider's limit further away.
  pausedUntil?: number
  wake?: NodeJS.Timeout
}

declare global {
  var __ambleModelSlots: Slots | undefined
}

// On globalThis: the scheduled pass and the pages are separate bundles in one
// process, and they must count against the same limit.
const slots = (globalThis.__ambleModelSlots ??= { active: 0, interactive: [], background: [] })

function dispatch() {
  const paused = (slots.pausedUntil ?? 0) - Date.now()
  if (paused > 0) {
    slots.wake ??= setTimeout(() => {
      slots.wake = undefined
      dispatch()
    }, paused)
    return
  }
  while (slots.active < MODEL_CONCURRENCY && slots.interactive.length > 0) {
    slots.active++
    slots.interactive.shift()!()
  }
  while (slots.active < MODEL_CONCURRENCY - INTERACTIVE_RESERVE && slots.background.length > 0) {
    slots.active++
    slots.background.shift()!()
  }
}

function acquireSlot(background: boolean): Promise<void> {
  return new Promise((resolve) => {
    slots[background ? 'background' : 'interactive'].push(resolve)
    dispatch()
  })
}

function releaseSlot() {
  slots.active--
  dispatch()
}

// Busy, rate-limited or briefly unreachable: wait as long as the provider
// asks (or a growing while, never in step with the other calls waiting), with
// the slot given back, and try again, within a budget of time: a person on
// the screen is told sooner than a listening pass gives up.
const BUSY_STATUSES = new Set([429, 502, 503, 504])
const BUSY_RETRIES = 4
const MAX_WAIT_MS = 60_000
const RETRY_BUDGET_MS = { interactive: 60_000, background: 5 * 60_000 }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isBusy(error: unknown): error is ModelError {
  return error instanceof ModelError && (BUSY_STATUSES.has(error.status ?? 0) || error.unreachable === true)
}

function busyWait(error: ModelError, retry: number): number {
  const jitter = Math.random()
  // What the provider asked, and a little more so the calls waiting do not all come back at once.
  if (error.retryAfterMs) return Math.min(MAX_WAIT_MS, error.retryAfterMs + jitter * 1_000)
  const base = 2_000 * 2 ** retry
  return Math.min(MAX_WAIT_MS, base / 2 + (jitter * base) / 2)
}

async function callWhenFree(
  background: boolean,
  ...args: Parameters<typeof callChatCompletion>
): Promise<{ content: string; latencyMs: number }> {
  const deadline = Date.now() + RETRY_BUDGET_MS[background ? 'background' : 'interactive']
  for (let retry = 0; ; retry++) {
    await acquireSlot(background)
    let waitMs = 0
    try {
      return await callChatCompletion(...args)
    } catch (error) {
      if (!isBusy(error) || retry >= BUSY_RETRIES) throw error
      waitMs = busyWait(error, retry)
      if (Date.now() + waitMs > deadline) throw error
      if (error.status === 429) slots.pausedUntil = Math.max(slots.pausedUntil ?? 0, Date.now() + waitMs)
    } finally {
      releaseSlot()
    }
    await sleep(waitMs)
  }
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

// Retry-After is seconds or an HTTP date.
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  return ms > 0 ? ms : undefined
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
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
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
    throw new ModelError(error instanceof Error ? `Could not reach the model: ${error.message}` : 'Could not reach the model.', {
      unreachable: true,
    })
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
        : `${user}

IMPORTANT: your previous response failed validation: ${lastError?.detail ?? 'unknown issue'}. Respond again with JSON that strictly satisfies the schema.`
    const record = (outcome: { content: string | null; latencyMs: number | null; error: string | null }) =>
      insertModelRun({
        id: runId,
        candidate_id: candidateId,
        task,
        task_version: version,
        provider: config.provider,
        model_id: config.modelId,
        base_url: config.baseUrl,
        prompt_chars: attemptUser.length,
        output_chars: outcome.content?.length ?? 0,
        latency_ms: outcome.latencyMs,
        ok: outcome.error === null ? 1 : 0,
        error: outcome.error,
        raw_output: outcome.content?.slice(0, 8000) ?? null,
      })
    let reply: { content: string; latencyMs: number }
    try {
      reply = await callWhenFree(options.background ?? false, config.baseUrl, config.apiKey, config.modelId, system, attemptUser, temperature)
    } catch (error) {
      // HTTP, network or time: recorded, and the task ends.
      const modelError = error instanceof ModelError ? error : new ModelError(error instanceof Error ? error.message : 'Unknown model error')
      record({ content: null, latencyMs: null, error: modelError.message })
      throw modelError
    }
    const { content, latencyMs } = reply
    let parsed: unknown
    try {
      parsed = JSON.parse(stripCodeFences(content))
    } catch {
      // Invalid JSON deserves the retry.
      record({ content, latencyMs, error: 'Invalid JSON in model response' })
      lastError = new ModelError('The model returned invalid JSON.', { detail: 'json_parse' })
      continue
    }
    let validated: ReturnType<typeof schema.safeParse>
    try {
      validated = schema.safeParse(parsed)
    } catch (error) {
      // A shape so far off that reading it failed.
      const modelError = new ModelError('The model response could not be read.', { detail: error instanceof Error ? error.message : undefined })
      record({ content, latencyMs, error: modelError.message })
      throw modelError
    }
    if (!validated.success) {
      const issues = formatSchemaIssues(validated.error.issues)
      record({ content, latencyMs, error: `Schema validation failed: ${issues}` })
      lastError = new ModelError('The model response did not match the expected schema.', { detail: issues })
      continue
    }
    record({ content, latencyMs, error: null })
    return { data: validated.data, modelRunId: runId, latencyMs }
  }

  throw lastError ?? new ModelError('The model failed after repeated attempts.')
}
