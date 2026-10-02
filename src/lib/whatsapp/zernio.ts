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
      linkPreview: false,
      ...(params.buttons?.length ? { buttons: params.buttons.slice(0, 3).map((button) => ({ type: 'postback', ...button })) } : {}),
      ...(params.utility ? { category: 'utility' } : {}),
    },
    params.idempotencyKey,
  )
  return { messageId: result.data?.messageId ?? null }
}

// A picture with the text and up to three reply buttons under it, inside an
// open conversation: the picture is uploaded with the message, never left at
// an address anyone could open (it may show their answers).
export async function sendPicture(
  config: ZernioConfig,
  params: { conversationId: string; image: Buffer; filename: string; text: string; buttons?: Button[]; idempotencyKey?: string },
): Promise<{ messageId: string | null }> {
  const form = new FormData()
  form.set('accountId', config.accountId)
  form.set('message', params.text)
  form.set('attachment', new Blob([new Uint8Array(params.image)], { type: params.filename.endsWith('.png') ? 'image/png' : 'image/jpeg' }), params.filename)
  if (params.buttons?.length) form.set('buttons', JSON.stringify(params.buttons.slice(0, 3).map((button) => ({ type: 'postback', ...button }))))
  const response = await fetch(`${API}/inbox/conversations/${encodeURIComponent(params.conversationId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}) },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const data = (await response.json().catch(() => null)) as { data?: { messageId?: string }; error?: string; code?: string } | null
  if (!response.ok) throw new ZernioError(data?.error ?? `Zernio answered ${response.status}`, response.status, data?.code ?? null)
  return { messageId: data?.data?.messageId ?? null }
}

// An approved template to their number: what opens the conversation again
// once the 24 hours are over. Its variables, in order.
export async function sendTemplateMessage(
  config: ZernioConfig,
  params: { phone: string; name: string; language: string; values: string[]; idempotencyKey?: string },
): Promise<void> {
  await call(
    config,
    'POST',
    '/inbox/conversations',
    {
      accountId: config.accountId,
      participantId: params.phone.replace(/\D/g, ''),
      templateName: params.name,
      templateLanguage: params.language,
      templateParams: params.values,
    },
    params.idempotencyKey,
  )
}

export interface TemplateDefinition {
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING'
  body: string
  example: string[]
  buttons: string[]
}

// Submitted to Meta for review (up to 24 hours).
export async function createTemplate(config: ZernioConfig, template: TemplateDefinition): Promise<unknown> {
  return call(config, 'POST', '/whatsapp/templates', {
    accountId: config.accountId,
    name: template.name,
    category: template.category,
    language: template.language,
    components: [
      { type: 'body', text: template.body, example: { body_text: [template.example] } },
      { type: 'buttons', buttons: template.buttons.map((text) => ({ type: 'quick_reply', text })) },
    ],
  })
}

export async function listTemplates(config: ZernioConfig): Promise<unknown> {
  return call(config, 'GET', `/whatsapp/templates?accountId=${encodeURIComponent(config.accountId)}`)
}

// Seen: the blue ticks on what they sent.
export async function markRead(config: ZernioConfig, conversationId: string): Promise<void> {
  await call(config, 'POST', `/inbox/conversations/${encodeURIComponent(conversationId)}/read`, { accountId: config.accountId })
}

// "typing…" on their screen, for up to 25 seconds.
export async function showTyping(config: ZernioConfig, conversationId: string): Promise<void> {
  await call(config, 'POST', `/inbox/conversations/${encodeURIComponent(conversationId)}/typing`, { accountId: config.accountId })
}

// An emoji on one of their messages.
export async function react(config: ZernioConfig, conversationId: string, messageId: string, emoji: string): Promise<void> {
  await call(
    config,
    'POST',
    `/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    { accountId: config.accountId, emoji },
  )
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
