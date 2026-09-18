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
