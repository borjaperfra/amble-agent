// Helmcode's gateway, when its model struggles, sends the call to
// `<model>-fallback`, which our keys may not call, and answers 400. That is
// the model being busy, not a bad request: the call waits and goes again
// instead of failing at once (2026-11-09/10, nine reads in ten lost).
import assert from 'node:assert'
import { z } from 'zod'

process.env.AMBLE_MODEL_API_KEY = 'sk-test-gateway'
process.env.AMBLE_MODEL_ID = 'deepseek-v4-flash'
process.env.AMBLE_MODEL_BASE_URL = 'http://gateway.invalid/v1'

async function main() {
  const { ModelError, isBusy, runStructuredTask } = await import('../src/lib/model/provider')

  const FALLBACK = 'Invalid model name passed in model=deepseek-v4-flash-fallback. Call `/v1/models` to view available models for your key.'

  // The fallback 400 is busy; any other 400 is still a bad request.
  assert.equal(isBusy(new ModelError('The model returned an error (HTTP 400).', { status: 400, detail: FALLBACK })), true)
  assert.equal(isBusy(new ModelError('The model returned an error (HTTP 400).', { status: 400, detail: 'Invalid model name passed in model=gpt-x.' })), false)
  assert.equal(isBusy(new ModelError('The model returned an error (HTTP 400).', { status: 400, detail: "response_format type 'json_object' requires the word \"json\"" })), false)
  assert.equal(isBusy(new ModelError('The model returned an error (HTTP 400).', { status: 400 })), false)
  assert.equal(isBusy(new ModelError('The model returned an error (HTTP 503).', { status: 503 })), true)

  // End to end: first the gateway's 400, then an answer.
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: FALLBACK, type: 'invalid_request_error', code: '400' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const run = await runStructuredTask({
    candidateId: null,
    task: 'gateway_fallback_check',
    version: 'test',
    system: 'Answer in JSON.',
    user: 'Reply {"ok": true}',
    schema: z.object({ ok: z.boolean() }),
    language: null,
  })
  assert.deepEqual(run.data, { ok: true })
  assert.equal(calls, 2, 'the fallback 400 is tried again, once')

console.log('gateway fallback: waited and tried again')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
