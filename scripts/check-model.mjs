/**
 * Smoke test for the configured model.
 *
 *   npm run check:model
 *
 * Two short calls. It answers the questions you cannot answer by reading
 * the spec: does this model return usable JSON without server-side JSON
 * mode, does it actually reason, and what does the server do when it is
 * sent a response_format it does not support.
 */

const base = (process.env.AMBLE_MODEL_BASE_URL ?? '').replace(/\/+$/, '')
const model = process.env.AMBLE_MODEL_ID ?? ''
const key = process.env.AMBLE_MODEL_API_KEY ?? ''
const reasoning = /^(true|on|1|yes)$/i.test(process.env.AMBLE_MODEL_REASONING ?? '')
const jsonMode = !/^(false|off|0|no)$/i.test(process.env.AMBLE_MODEL_JSON_MODE ?? 'true')
const maxTokens = Number.parseInt(process.env.AMBLE_MODEL_MAX_TOKENS ?? '', 10)
const timeoutMs = Number.parseInt(process.env.AMBLE_MODEL_TIMEOUT_MS ?? '', 10) || 120_000

if (!base || !model || !key) {
  console.error('Missing AMBLE_MODEL_BASE_URL, AMBLE_MODEL_ID or AMBLE_MODEL_API_KEY in .env.local.')
  process.exit(1)
}

const masked = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '(short key)'
console.log(`base      ${base}`)
console.log(`model     ${model}`)
console.log(`key       ${masked}`)
console.log(`json_mode ${jsonMode ? 'on' : 'off'}`)
console.log(`reasoning ${reasoning ? `on (${process.env.AMBLE_MODEL_REASONING_EFFORT ?? 'medium'})` : 'off'}`)
console.log()

const SYSTEM =
  'You are a JSON API. Respond ONLY with a JSON object, no prose. Schema: {"capability": string, "assessment": "STRONG_EVIDENCE"|"LIMITED_EVIDENCE", "reason": string}'
const USER =
  'Evidence: "Led the rebrand of a developer tools company" (one source, no metrics, no team size). ' +
  'Assess the capability "brand positioning". Be strict: one unverified line is not strong evidence.'

async function call(label, overrides) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: USER },
    ],
    temperature: 0.2,
    ...overrides,
  }
  if (Number.isFinite(maxTokens) && maxTokens > 0) payload.max_tokens = maxTokens

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const elapsed = Date.now() - startedAt
    const text = await response.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      /* server returned something that is not JSON at all */
    }

    if (!response.ok) {
      console.log(`${label}: HTTP ${response.status} after ${elapsed}ms`)
      console.log(`  ${body?.error?.message ?? text.slice(0, 300)}`)
      return { ok: false, status: response.status }
    }

    const choice = body?.choices?.[0]
    const content = choice?.message?.content ?? ''
    const trace = choice?.message?.reasoning_content ?? null

    console.log(`${label}: HTTP 200 in ${(elapsed / 1000).toFixed(1)}s`)
    console.log(`  finish_reason      ${choice?.finish_reason ?? '(none)'}`)
    console.log(`  reasoning_content  ${trace ? `${trace.length} chars` : 'absent'}`)
    console.log(`  usage              ${JSON.stringify(body?.usage ?? {})}`)

    let parsed = null
    try {
      parsed = JSON.parse(content.trim().replace(/^```(?:json)?|```$/g, '').trim())
      console.log('  parses as JSON     yes, straight off')
    } catch {
      const start = content.indexOf('{')
      const end = content.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          parsed = JSON.parse(content.slice(start, end + 1))
          console.log('  parses as JSON     only after digging it out of the prose')
        } catch {
          /* still not JSON */
        }
      }
      if (!parsed) console.log('  parses as JSON     NO')
    }

    if (parsed) console.log(`  object             ${JSON.stringify(parsed)}`)
    else console.log(`  raw                ${content.slice(0, 300)}`)

    return { ok: true, parsed: Boolean(parsed), reasoned: Boolean(trace) }
  } catch (error) {
    console.log(`${label}: failed — ${error.name === 'AbortError' ? `no answer in ${timeoutMs}ms` : error.message}`)
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

const asConfigured = {}
if (jsonMode) asConfigured.response_format = { type: 'json_object' }
if (reasoning) asConfigured.reasoning_effort = process.env.AMBLE_MODEL_REASONING_EFFORT ?? 'medium'

const main = await call('as configured', asConfigured)
console.log()

// The question the spec does not answer: rejected, or silently ignored?
const probe = await call('with response_format forced on', {
  ...asConfigured,
  response_format: { type: 'json_object' },
})

console.log()
if (!main.ok) {
  console.log('The configured setup does not work. Fix that before running a CV through it.')
  process.exit(1)
} else if (!main.parsed) {
  console.log('Reachable, but it did not return parseable JSON. Amble will retry once and then fail honestly.')
  process.exit(1)
} else {
  console.log('Good: reachable and returning valid JSON.')
  if (reasoning && !main.reasoned) {
    console.log('Note: no reasoning_content came back, so reasoning_effort may be ignored by this model.')
  }
  if (!jsonMode) {
    console.log(
      probe.ok
        ? 'Note: the server accepted response_format on this model rather than rejecting it.'
        : 'Confirmed: this model rejects response_format, so AMBLE_MODEL_JSON_MODE=off is required.',
    )
  }
}
