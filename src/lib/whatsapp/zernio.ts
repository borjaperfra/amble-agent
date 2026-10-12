import { createHmac, timingSafeEqual } from 'node:crypto'
import { safeFetchBytes, TooLargeError } from '../net/safe-fetch'

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
  // Telegram only: it opens this address instead. WhatsApp leaves it out.
  url?: string
  // Telegram only: it opens a chat of theirs to share this (an inline query).
  share?: string
}

// WhatsApp's reply buttons: three at most, none that opens an address.
const replyButtons = (buttons: Button[]) => buttons.filter((button) => !button.url).slice(0, 3).map(({ title, payload }) => ({ type: 'postback', title, payload }))

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
      ...(params.buttons?.length ? { buttons: replyButtons(params.buttons) } : {}),
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
  if (params.buttons?.length) form.set('buttons', JSON.stringify(replyButtons(params.buttons)))
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

export interface WhatsAppAccountStatus {
  displayName: string | null
  nameStatus: string | null
  lastReviewedName: string | null
  // The last thing Meta said about the business (a review, a restriction).
  lastEvent: string | null
  messagingLimitTier: string | null
  qualityRating: string | null
  templates: { name: string; language: string | null; category: string | null; status: string | null }[]
}

// A field wherever the provider nests it (on the account, or under its
// metadata), as text; only the fields named here ever leave this function.
function field(source: unknown, key: string, depth = 0): string | null {
  if (!source || typeof source !== 'object' || depth > 3) return null
  const record = source as Record<string, unknown>
  const value = record[key]
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = field(nested, key, depth + 1)
      if (found !== null) return found
    }
  }
  return null
}

function listOf(result: unknown, keys: string[]): unknown[] {
  if (Array.isArray(result)) return result
  for (const key of keys) {
    const value = (result as Record<string, unknown> | null)?.[key]
    if (Array.isArray(value)) return value
  }
  return []
}

// How the number stands with Meta, for the owner's health tab: its name and
// whether it was approved, the business's last event, its sending tier and
// quality, and each template's review.
// What Meta last said about the business: an object ({event, violation_info},
// with when), not a string, so the plain reader above found nothing and the
// health tab showed no event while a SCAM violation stood (2026-10-09).
function lastEventOf(account: unknown): string | null {
  const find = (source: unknown, depth = 0): { status: Record<string, unknown>; event: unknown } | null => {
    if (!source || typeof source !== 'object' || depth > 3) return null
    const record = source as Record<string, unknown>
    if ('lastEvent' in record) return { status: record, event: record.lastEvent }
    for (const nested of Object.values(record)) {
      const found = nested && typeof nested === 'object' && !Array.isArray(nested) ? find(nested, depth + 1) : null
      if (found) return found
    }
    return null
  }
  const found = find(account)
  if (!found?.event) return null
  if (typeof found.event === 'string') return found.event
  if (typeof found.event !== 'object') return null
  const event = found.event as Record<string, unknown>
  const name = typeof event.event === 'string' ? event.event : 'EVENT'
  const violation = (event.violation_info as Record<string, unknown> | undefined)?.violation_type
  const at = typeof found.status.lastEventAt === 'string' ? found.status.lastEventAt.slice(0, 10) : null
  return [name, typeof violation === 'string' ? violation : null, at].filter(Boolean).join(' · ')
}

export async function whatsappAccountStatus(config: ZernioConfig): Promise<WhatsAppAccountStatus> {
  const [accounts, templates] = await Promise.all([call<unknown>(config, 'GET', '/accounts?platform=whatsapp'), listTemplates(config)])
  const listed = listOf(accounts, ['accounts', 'data'])
  // Ours among them, by its id; else the only one there is.
  const account =
    listed.find((entry) => ['_id', 'id', 'accountId'].some((key) => String((entry as Record<string, unknown> | null)?.[key] ?? '') === config.accountId)) ??
    listed[0] ??
    null
  return {
    displayName: field(account, 'displayName'),
    nameStatus: field(account, 'nameStatus'),
    lastReviewedName: field(account, 'lastReviewedName'),
    lastEvent: lastEventOf(account),
    messagingLimitTier: field(account, 'messagingLimitTier'),
    qualityRating: field(account, 'qualityRating'),
    templates: listOf(templates, ['data', 'templates']).map((template) => ({
      name: field(template, 'name') ?? '?',
      language: field(template, 'language'),
      category: field(template, 'category'),
      status: field(template, 'status'),
    })),
  }
}

// A file someone sent (a document): fetched from Zernio's own media endpoint,
// which needs our key, so only from there and from nowhere else the payload
// might point. Over https, through the guarded fetch, bounded in time and in
// bytes; a local stand-in over http (ZERNIO_API_URL, for tests) is reached
// as it is, with the same bounds.
// Null when it is not Zernio's, or not there; TooLargeError past maxBytes.
export async function fetchMedia(config: ZernioConfig, url: string, maxBytes: number): Promise<Buffer | null> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  if (target.origin !== new URL(API).origin) return null
  const headers = { Authorization: `Bearer ${config.apiKey}` }
  if (new URL(API).protocol === 'https:') {
    const response = await safeFetchBytes(target.toString(), { headers, timeoutMs: MEDIA_MS, maxBytes })
    return response.status >= 200 && response.status < 300 ? response.body : null
  }
  const response = await fetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(MEDIA_MS) })
  if (!response.ok) return null
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new TooLargeError()
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new TooLargeError()
  return bytes
}

const MEDIA_MS = 30_000

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
