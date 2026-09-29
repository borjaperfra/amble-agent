import { createHmac, timingSafeEqual } from 'node:crypto'

// Zernio, the provider between amble and WhatsApp's Cloud API
// (docs.zernio.com/platforms/whatsapp). The number sits in our own WhatsApp
// Business Account, so another provider can take it over.
//
// Two rules shape every send: a message a person can reply to freely only
// within 24 hours of their last message; after that, only an approved
// template (or Meta's Direct Send for utility messages, where the account is
// eligible) opens the conversation again.

// Overridable only to test against a local stand-in.
const API = process.env.ZERNIO_API_URL?.trim() || 'https://zernio.com/api/v1'

export interface ZernioConfig {
  apiKey: string
  accountId: string
  // The number people write to, digits only (for wa.me links).
  number: string
  webhookSecret: string | null
  // Zernio's shared test number: one locked template, one test phone.
  sandbox: boolean
}

export function zernioConfig(): ZernioConfig | null {
  const apiKey = process.env.ZERNIO_API_KEY?.trim()
  const accountId = process.env.ZERNIO_ACCOUNT_ID?.trim()
  const number = process.env.ZERNIO_NUMBER?.replace(/\D/g, '')
  if (!apiKey || !accountId || !number) return null
  return {
    apiKey,
    accountId,
    number,
    webhookSecret: process.env.ZERNIO_WEBHOOK_SECRET?.trim() || null,
    sandbox: process.env.ZERNIO_SANDBOX === '1',
  }
}

export class ZernioError extends Error {
  status: number
  code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'ZernioError'
    this.status = status
    this.code = code
  }
}

async function call<T>(config: ZernioConfig, method: 'GET' | 'POST', route: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // A send is not idempotent on their side: with a key, a retry is safe.
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const data = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null
  if (!response.ok) throw new ZernioError(data?.error ?? `Zernio answered ${response.status}`, response.status, data?.code ?? null)
  return data as T
}

export interface Button {
  title: string
  // What comes back on the webhook when it is tapped.
  payload: string
}

// A message in a conversation that is open: free text, and up to three reply
// buttons. `utility` sends it as a business-initiated utility message when the
// 24-hour window is closed (Meta's Direct Send).
export async function sendMessage(
  config: ZernioConfig,
  params: { conversationId: string; text: string; buttons?: Button[]; utility?: boolean; idempotencyKey?: string },
): Promise<{ messageId: string | null }> {
  const result = await call<{ data?: { messageId?: string } }>(
    config,
    'POST',
    `/inbox/conversations/${encodeURIComponent(params.conversationId)}/messages`,
    {
      accountId: config.accountId,
      message: params.text,
      ...(params.buttons?.length ? { buttons: params.buttons.slice(0, 3).map((button) => ({ type: 'postback', ...button })) } : {}),
      ...(params.utility ? { category: 'utility' } : {}),
    },
    params.idempotencyKey,
  )
  return { messageId: result.data?.messageId ?? null }
}

// The provider signs each delivery: lowercase hex HMAC-SHA256 of the raw body.
export function signatureIsValid(config: ZernioConfig, rawBody: string, signature: string | null): boolean {
  if (!config.webhookSecret || !signature) return false
  const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex')
  const given = signature.trim().toLowerCase()
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

// A wa.me link that opens WhatsApp with the message already written.
export function chatLink(config: ZernioConfig, text: string): string {
  return `https://wa.me/${config.number}?text=${encodeURIComponent(text)}`
}
