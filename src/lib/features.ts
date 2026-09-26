export interface ModelConfig {
  provider: string
  baseUrl: string
  modelId: string
  apiKey: string
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super(
      "The model isn't configured. Set AMBLE_MODEL_API_KEY and AMBLE_MODEL_ID (see .env.example), then restart the server.",
    )
    this.name = 'ModelNotConfiguredError'
  }
}

export function getModelConfig(): ModelConfig | null {
  const apiKey = process.env.AMBLE_MODEL_API_KEY?.trim()
  const modelId = process.env.AMBLE_MODEL_ID?.trim()
  if (!apiKey || !modelId) return null
  return {
    provider: process.env.AMBLE_MODEL_PROVIDER?.trim() || 'openai-compatible',
    baseUrl: (process.env.AMBLE_MODEL_BASE_URL?.trim() || 'https://api.deepseek.com').replace(
      /\/+$/,
      '',
    ),
    modelId,
    apiKey,
  }
}
