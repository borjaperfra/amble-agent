import { serverText } from './i18n/candidate'

export interface ModelConfig {
  provider: string
  baseUrl: string
  modelId: string
  apiKey: string
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super(serverText().modelNotConfigured)
    this.name = 'ModelNotConfiguredError'
  }
}

export function getModelConfig(): ModelConfig | null {
  // One key, or the first of several (the calls themselves are spread over all
  // of them: src/lib/model/provider.ts).
  const apiKey = process.env.AMBLE_MODEL_API_KEY?.trim() || process.env.AMBLE_MODEL_API_KEYS?.split(',')[0]?.trim()
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
