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
  // How long one answer may take. A long read (a CV into statements, the map
  // weighed) writes tens of thousands of tokens: at two minutes a slow model
  // cut it short again and again (2026-10-08, a CV retried for an hour).
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

// The provider limits requests in flight per key (Helmcode allows 10 per key
// on deepseek-v4-flash). With several keys (AMBLE_MODEL_API_KEYS, comma
// separated; else AMBLE_MODEL_API_KEY) each call takes a slot on the key with
// most room, and a 429 pauses only the key that got it: more keys, more calls
// at once, the same model. On every key background work never takes the last
// few slots, so a person on the screen is not queued behind a listening pass.
const MODEL_CONCURRENCY = Math.max(1, Number(process.env.AMBLE_MODEL_CONCURRENCY) || 10)
const INTERACTIVE_RESERVE = Math.min(3, MODEL_CONCURRENCY - 1)

function modelKeys(): string[] {
  const many = (process.env.AMBLE_MODEL_API_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
  const one = process.env.AMBLE_MODEL_API_KEY?.trim()
  return [...new Set(many.length > 0 ? many : one ? [one] : [])]
}

// Background calls that may run at once across all keys: how many reads a
// listening pass keeps going.
export const BACKGROUND_SLOTS = Math.max(1, modelKeys().length) * (MODEL_CONCURRENCY - INTERACTIVE_RESERVE)

interface KeyPool {
  key: string
  active: number
  // After a 429 no call starts on this key before this: the calls waiting
  // would all be refused too, and each refusal pushes its limit further away.
  pausedUntil: number
  // Background work waits longer than that after a 429: when the key reopens,
  // a person on the screen gets it first, and the read that filled it eases off.
  backgroundPausedUntil: number
}

interface Slots {
  pools: KeyPool[]
  interactive: ((pool: KeyPool) => void)[]
  background: ((pool: KeyPool) => void)[]
  wake?: NodeJS.Timeout
}

declare global {
  var __ambleModelSlots: Slots | undefined
}

// On globalThis: the scheduled pass and the pages are separate bundles in one
// process, and they must count against the same limits.
const slots = (globalThis.__ambleModelSlots ??= {
  pools: modelKeys().map((key) => ({ key, active: 0, pausedUntil: 0, backgroundPausedUntil: 0 })),
  interactive: [],
  background: [],
})

// The open key with the most room for this kind of call, if any.
function freePool(background: boolean, now: number): KeyPool | null {
  const limit = background ? MODEL_CONCURRENCY - INTERACTIVE_RESERVE : MODEL_CONCURRENCY
  let best: KeyPool | null = null
  for (const pool of slots.pools) {
    if (pool.pausedUntil > now || pool.active >= limit || (background && (pool.backgroundPausedUntil ?? 0) > now)) continue
    if (!best || pool.active < best.active) best = pool
  }
  return best
}

function dispatch() {
  const now = Date.now()
  for (const kind of ['interactive', 'background'] as const) {
    const queue = slots[kind]
    for (let pool = freePool(kind === 'background', now); pool && queue.length > 0; pool = freePool(kind === 'background', now)) {
      pool.active++
      queue.shift()!(pool)
    }
  }
  // Calls waiting only on keys that are paused: look again when the first reopens.
  if (slots.interactive.length + slots.background.length > 0 && !slots.wake) {
    const reopen = Math.min(
      ...slots.pools
        .flatMap((pool) => (slots.background.length > 0 ? [pool.pausedUntil, pool.backgroundPausedUntil ?? 0] : [pool.pausedUntil]))
        .filter((until) => until > now),
    )
    if (Number.isFinite(reopen)) {
      slots.wake = setTimeout(() => {
        slots.wake = undefined
        dispatch()
      }, reopen - now)
    }
  }
}

function acquireSlot(background: boolean): Promise<KeyPool> {
  return new Promise((resolve) => {
    slots[background ? 'background' : 'interactive'].push(resolve)
    dispatch()
  })
}

function releaseSlot(pool: KeyPool) {
  pool.active--
  dispatch()
}

// Busy, rate-limited or briefly unreachable: wait as long as the provider
// asks (or a growing while, never in step with the other calls waiting), with
// the slot given back, and try again, within a budget of time: a person on
// the screen is told sooner than a listening pass gives up.
const BUSY_STATUSES = new Set([429, 502, 503, 504])
// A person on the screen tries more often within its minute; a read, fewer times over longer.
const BUSY_RETRIES = { interactive: 8, background: 4 }
// After a 429, how much longer background work stays off the key.
const BACKGROUND_EXTRA_PAUSE_MS = 30_000
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
  baseUrl: string,
  modelId: string,
  system: string,
  user: string,
  temperature: number,
  timeoutMs: number,
): Promise<{ content: string; latencyMs: number; usage: Usage }> {
  const deadline = Date.now() + RETRY_BUDGET_MS[background ? 'background' : 'interactive']
  for (let retry = 0; ; retry++) {
    const pool = await acquireSlot(background)
    let waitMs = 0
    try {
      return await callChatCompletion(baseUrl, pool.key, modelId, system, user, temperature, timeoutMs)
    } catch (error) {
      if (!isBusy(error) || retry >= BUSY_RETRIES[background ? 'background' : 'interactive']) throw error
      waitMs = busyWait(error, retry)
      if (Date.now() + waitMs > deadline) throw error
      // Rate-limited: that key waits; the call goes on at once on another key
      // with room, or when one reopens.
      if (error.status === 429) {
        pool.pausedUntil = Math.max(pool.pausedUntil, Date.now() + waitMs)
        pool.backgroundPausedUntil = Math.max(pool.backgroundPausedUntil ?? 0, Date.now() + waitMs + BACKGROUND_EXTRA_PAUSE_MS)
        waitMs = 0
      }
    } finally {
      releaseSlot(pool)
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
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    // OpenAI's shape (what Helmcode returns) and DeepSeek's own.
    prompt_tokens_details?: { cached_tokens?: number }
    prompt_cache_hit_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

// What the provider counted for one call; null where it says nothing.
export interface Usage {
  promptTokens: number | null
  cachedTokens: number | null
  completionTokens: number | null
  reasoningTokens: number | null
}

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

function usageOf(body: ChatCompletionResponse | null): Usage {
  const usage = body?.usage
  return {
    promptTokens: count(usage?.prompt_tokens),
    cachedTokens: count(usage?.prompt_tokens_details?.cached_tokens) ?? count(usage?.prompt_cache_hit_tokens),
    completionTokens: count(usage?.completion_tokens),
    reasoningTokens: count(usage?.completion_tokens_details?.reasoning_tokens),
  }
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
  timeoutMs: number,
): Promise<{ content: string; latencyMs: number; usage: Usage }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
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
    return { content, latencyMs, usage: usageOf(body) }
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
    const record = (outcome: { content: string | null; latencyMs: number | null; error: string | null; usage?: Usage }) =>
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
        prompt_tokens: outcome.usage?.promptTokens ?? null,
        cached_tokens: outcome.usage?.cachedTokens ?? null,
        completion_tokens: outcome.usage?.completionTokens ?? null,
        reasoning_tokens: outcome.usage?.reasoningTokens ?? null,
      })
    let reply: { content: string; latencyMs: number; usage: Usage }
    try {
      reply = await callWhenFree(options.background ?? false, config.baseUrl, config.modelId, system, attemptUser, temperature, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    } catch (error) {
      // HTTP, network or time: recorded, and the task ends.
      const modelError = error instanceof ModelError ? error : new ModelError(error instanceof Error ? error.message : 'Unknown model error')
      record({ content: null, latencyMs: null, error: modelError.message })
      throw modelError
    }
    const { content, latencyMs, usage } = reply
    let parsed: unknown
    try {
      parsed = JSON.parse(stripCodeFences(content))
    } catch {
      // Invalid JSON deserves the retry.
      record({ content, latencyMs, usage, error: 'Invalid JSON in model response' })
      lastError = new ModelError('The model returned invalid JSON.', { detail: 'json_parse' })
      continue
    }
    let validated: ReturnType<typeof schema.safeParse>
    try {
      validated = schema.safeParse(parsed)
    } catch (error) {
      // A shape so far off that reading it failed.
      const modelError = new ModelError('The model response could not be read.', { detail: error instanceof Error ? error.message : undefined })
      record({ content, latencyMs, usage, error: modelError.message })
      throw modelError
    }
    if (!validated.success) {
      const issues = formatSchemaIssues(validated.error.issues)
      record({ content, latencyMs, usage, error: `Schema validation failed: ${issues}` })
      lastError = new ModelError('The model response did not match the expected schema.', { detail: issues })
      continue
    }
    record({ content, latencyMs, usage, error: null })
    return { data: validated.data, modelRunId: runId, latencyMs }
  }

  throw lastError ?? new ModelError('The model failed after repeated attempts.')
}
