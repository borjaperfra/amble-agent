/**
 * The Telegram sender, against a stubbed API.
 *
 * Two things are worth pinning down. One is the length: Telegram refuses
 * anything over 4096 characters outright, and an interruption with four
 * pieces of evidence behind each of three claims gets close, so a message
 * that silently vanished because nobody counted would be the worst kind of
 * failure — the person never learns there was anything to learn.
 *
 * The other is the token. These errors land in a job's `last_error` column,
 * and a bot token in a database column is a bot somebody else can send
 * messages as.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fitMessage, sendTelegramMessage, TELEGRAM_LIMIT, TelegramError } from './telegram'
import type { TelegramConfig } from '@/lib/features'

const config: TelegramConfig = { token: '123456:SECRET-TOKEN-DO-NOT-LEAK', timeoutMs: 5_000 }

function stubFetch(status: number, payload: unknown) {
  const calls: { url: string; body: unknown }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

describe('fitMessage', () => {
  it('leaves a message that fits exactly as it is', () => {
    const text = 'Your Rep found something.\n\nHead of Growth at Halvard.'
    assert.equal(fitMessage(text), text)
  })

  it('cuts at a paragraph and says where it stopped', () => {
    // Numbered so a half-kept paragraph is visible: each one ends in END.
    const long = Array.from(
      { length: 20 },
      (_, index) => `Paragraph ${index} ${'x'.repeat(480)} END`,
    ).join('\n\n')
    const fitted = fitMessage(long)

    assert.ok(fitted.length <= TELEGRAM_LIMIT)
    assert.match(fitted, /…the rest is on the screen\.$/)

    // Every paragraph that made it is whole: as many starts as endings.
    const kept = fitted.replace(/\n\n…the rest is on the screen\.$/, '')
    assert.equal(kept.match(/Paragraph \d+/g)?.length, kept.match(/END/g)?.length)
    assert.ok(kept.endsWith('END'), 'it stops at the end of a paragraph, not inside one')
  })

  it('still fits when there is nowhere sensible to break', () => {
    const fitted = fitMessage('y'.repeat(9000))
    assert.ok(fitted.length <= TELEGRAM_LIMIT)
  })
})

describe('sendTelegramMessage', () => {
  it('posts the message to the chat, with the preview out of the way', async () => {
    const stub = stubFetch(200, { ok: true, result: { message_id: 1 } })
    try {
      await sendTelegramMessage(config, '4242', 'Your Rep found something.')
      assert.equal(stub.calls.length, 1)
      assert.match(stub.calls[0].url, /\/bot123456:SECRET-TOKEN-DO-NOT-LEAK\/sendMessage$/)
      assert.deepEqual(stub.calls[0].body, {
        chat_id: '4242',
        text: 'Your Rep found something.',
        // The link at the end is an invitation to open the screen, not a
        // card to look at instead of reading the message.
        disable_web_page_preview: true,
      })
    } finally {
      stub.restore()
    }
  })

  it('reports what Telegram said without repeating the token', async () => {
    const stub = stubFetch(403, { ok: false, error_code: 403, description: 'Forbidden: bot blocked' })
    try {
      await assert.rejects(sendTelegramMessage(config, '4242', 'hello'), (error: unknown) => {
        assert.ok(error instanceof TelegramError)
        assert.match(error.message, /403/)
        assert.match(error.message, /bot blocked/)
        assert.ok(
          !error.message.includes('SECRET-TOKEN-DO-NOT-LEAK'),
          'the token must not travel into a job error column',
        )
        return true
      })
    } finally {
      stub.restore()
    }
  })

  it('treats a 200 that says ok:false as the refusal it is', async () => {
    const stub = stubFetch(200, { ok: false, error_code: 400, description: 'chat not found' })
    try {
      await assert.rejects(sendTelegramMessage(config, 'nope', 'hello'), /chat not found/)
    } finally {
      stub.restore()
    }
  })
})
