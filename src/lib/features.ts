export function isUserZero(): boolean {
  return process.env.AMBLE_USER_ZERO === 'true'
}

export type ReasoningEffort = 'low' | 'medium' | 'high'

export interface ModelConfig {
  provider: string
  baseUrl: string
  modelId: string
  apiKey: string
  /**
   * Whether to send `response_format: { type: 'json_object' }`.
   *
   * Not every model honours it. On Helmcode it is validated on qwen3.6 and
   * gemma4 but not on deepseek-v4-flash, which rejects or ignores it. When
   * this is off we rely on the prompt asking for JSON plus tolerant parsing
   * and schema validation, which is what every task already does anyway.
   */
  jsonMode: boolean
  /** Send `reasoning_effort` at all. Only reasoning models accept it. */
  reasoning: boolean
  /** Default effort when a task does not ask for a specific one. */
  reasoningEffort: ReasoningEffort
  /** Explicit `max_tokens`. A reasoning trace eats budget before the JSON. */
  maxTokens: number | null
  timeoutMs: number
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super(
      "The model isn't configured. Set AMBLE_MODEL_API_KEY and AMBLE_MODEL_ID (see .env.example), then restart the server.",
    )
    this.name = 'ModelNotConfiguredError'
  }
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === 'on' || raw === '1' || raw === 'yes'
}

function readEffort(name: string, fallback: ReasoningEffort): ReasoningEffort {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : fallback
}

function readPositiveInt(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export interface SttConfig {
  baseUrl: string
  model: string
  apiKey: string
  /** ISO-639-1 hint, or empty to let the transcriber decide. */
  language: string
  /** The endpoint returns 524 past roughly two minutes, so we stop before it. */
  maxSeconds: number
  maxBytes: number
}

/**
 * Speech to text. Falls back to the model key, since it is the same provider
 * unless someone deliberately splits them.
 */
export function getSttConfig(): SttConfig | null {
  const apiKey = process.env.AMBLE_STT_API_KEY?.trim() || process.env.AMBLE_MODEL_API_KEY?.trim()
  const model = process.env.AMBLE_STT_MODEL?.trim()
  if (!apiKey || !model) return null
  return {
    baseUrl: (
      process.env.AMBLE_STT_BASE_URL?.trim() ||
      process.env.AMBLE_MODEL_BASE_URL?.trim() ||
      'https://api.helmcode.com/v1'
    ).replace(/\/+$/, ''),
    model,
    apiKey,
    language: process.env.AMBLE_STT_LANGUAGE?.trim() ?? '',
    maxSeconds: readPositiveInt('AMBLE_STT_MAX_SECONDS', 110) ?? 110,
    maxBytes: (readPositiveInt('AMBLE_STT_MAX_MB', 24) ?? 24) * 1024 * 1024,
  }
}

/**
 * How often to go and look for new offers, in hours, across every source.
 * Unset or zero means never on its own, and the button in the lab is the
 * only way in.
 *
 * There is no cron daemon here and there does not need to be: the queue
 * already knows how to run something later and survive a restart, so a
 * recurring sync is a job that puts the next one on the queue before it
 * finishes. It runs while the server does, which for something used from a
 * phone is the same thing.
 */
export function getSourceSyncIntervalMs(): number | null {
  const hours = (
    process.env.AMBLE_SOURCE_SYNC_HOURS ?? process.env.AMBLE_MANFRED_SYNC_HOURS
  )?.trim()
  if (!hours) return null
  const value = Number.parseFloat(hours)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 3_600_000) : null
}

export interface TelegramConfig {
  token: string
  timeoutMs: number
}

/**
 * A bot token, and that is the whole setup.
 *
 * No template to get approved, no business verification, no number to
 * provision — which is why the interruption arrives here in full and arrives
 * on WhatsApp as a link to it.
 */
export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.AMBLE_TELEGRAM_BOT_TOKEN?.trim()
  if (!token) return null
  return { token, timeoutMs: readPositiveInt('AMBLE_TELEGRAM_TIMEOUT_MS', 15_000) ?? 15_000 }
}

export interface SmtpConfig {
  host: string
  port: number
  user: string | null
  password: string | null
  /** What the message says it is from. Falls back to the login user. */
  from: string
  fromName: string
  /** TLS from the first byte (465) rather than STARTTLS after EHLO (587). */
  implicitTls: boolean
  timeoutMs: number
}

/**
 * Where the one message goes.
 *
 * Null when it is not set up, and the outbox says so out loud rather than
 * pretending: a notification that was written and never sent is a different
 * thing from one that was delivered, and the person is entitled to know
 * which they have.
 */
/**
 * Why there is no mail server, when there is no mail server.
 *
 * Half-filled is the state that actually happens: the host and the user are
 * pasted from a provider's setup page and the key comes later. Treating that
 * as configured means every interruption queues, tries, fails authentication
 * and retries for ten minutes — and the outbox says "failed", which reads
 * like the message was rejected rather than never really set up.
 */
export function smtpProblem(): string | null {
  const host = process.env.AMBLE_SMTP_HOST?.trim()
  if (!host) return 'No mail server. Set AMBLE_SMTP_HOST, and AMBLE_SMTP_FROM or _USER.'

  const user = process.env.AMBLE_SMTP_USER?.trim()
  if (!(process.env.AMBLE_SMTP_FROM?.trim() || user)) {
    return 'The mail server has no sender. Set AMBLE_SMTP_FROM.'
  }
  if (user && !process.env.AMBLE_SMTP_PASSWORD?.trim()) {
    return `${host} wants a login and AMBLE_SMTP_PASSWORD is empty. Paste the key.`
  }
  return null
}

export function getSmtpConfig(): SmtpConfig | null {
  if (smtpProblem() !== null) return null
  const host = process.env.AMBLE_SMTP_HOST!.trim()
  const user = process.env.AMBLE_SMTP_USER?.trim() || null
  const from = (process.env.AMBLE_SMTP_FROM?.trim() || user) as string
  const port = readPositiveInt('AMBLE_SMTP_PORT', 587) ?? 587
  return {
    host,
    port,
    user,
    password: process.env.AMBLE_SMTP_PASSWORD ?? null,
    from,
    fromName: process.env.AMBLE_SMTP_FROM_NAME?.trim() || 'Amble',
    implicitTls: readBoolean('AMBLE_SMTP_IMPLICIT_TLS', port === 465),
    timeoutMs: readPositiveInt('AMBLE_SMTP_TIMEOUT_MS', 20_000) ?? 20_000,
  }
}

export function getModelConfig(): ModelConfig | null {
  const apiKey = process.env.AMBLE_MODEL_API_KEY?.trim()
  const modelId = process.env.AMBLE_MODEL_ID?.trim()
  if (!apiKey || !modelId) return null
  return {
    provider: process.env.AMBLE_MODEL_PROVIDER?.trim() || 'openai-compatible',
    baseUrl: (process.env.AMBLE_MODEL_BASE_URL?.trim() || 'https://api.helmcode.com/v1').replace(
      /\/+$/,
      '',
    ),
    modelId,
    apiKey,
    jsonMode: readBoolean('AMBLE_MODEL_JSON_MODE', true),
    reasoning: readBoolean('AMBLE_MODEL_REASONING', false),
    reasoningEffort: readEffort('AMBLE_MODEL_REASONING_EFFORT', 'medium'),
    maxTokens: readPositiveInt('AMBLE_MODEL_MAX_TOKENS', null),
    timeoutMs: readPositiveInt('AMBLE_MODEL_TIMEOUT_MS', 120_000) ?? 120_000,
  }
}
