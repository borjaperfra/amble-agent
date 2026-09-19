/**
 * The SMTP client, against a server that only exists for the test.
 *
 * Hand-rolling a protocol client and then never exercising it would be worse
 * than pulling in a library. So there is a fake server here: it speaks real
 * replies over a real socket on a real port, and the test reads back the
 * dialogue the client produced. Nothing leaves the machine.
 */

import assert from 'node:assert/strict'
import net from 'node:net'
import { after, before, describe, it } from 'node:test'
import { buildMessage, sendMail, SmtpError } from './smtp'
import type { SmtpConfig } from '@/lib/features'

interface FakeServer {
  port: number
  /** Every line the client sent, in order. */
  received: string[]
  close: () => Promise<void>
}

/**
 * A server that answers 250 to everything except where the protocol demands
 * another code, unless `refuse` says otherwise for a given verb.
 */
function startServer(refuse: Record<string, string> = {}): Promise<FakeServer> {
  const received: string[] = []

  const server = net.createServer((socket) => {
    let buffer = ''
    let inData = false
    socket.setEncoding('utf8')
    socket.write('220 fake.amble ESMTP\r\n')

    socket.on('data', (chunk: string) => {
      buffer += chunk
      for (;;) {
        const at = buffer.indexOf('\r\n')
        if (at === -1) break
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        received.push(line)

        if (inData) {
          if (line === '.') {
            inData = false
            socket.write('250 2.0.0 Queued\r\n')
          }
          continue
        }

        const verb = line.split(' ')[0].toUpperCase()
        const refusal = refuse[verb]
        if (refusal) {
          socket.write(`${refusal}\r\n`)
          continue
        }
        if (verb === 'EHLO') {
          // Multi-line on purpose: reading one line at a time is the mistake
          // this client is written to avoid.
          socket.write('250-fake.amble\r\n250-SIZE 10240000\r\n250-AUTH LOGIN PLAIN\r\n250 HELP\r\n')
        } else if (verb === 'DATA') {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n')
          socket.end()
        } else if (verb === 'AUTH') {
          socket.write('235 2.7.0 Authentication successful\r\n')
        } else {
          socket.write('250 2.1.0 Ok\r\n')
        }
      }
    })
    socket.on('error', () => {
      /* the client hanging up is not news */
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo
      resolve({
        port: address.port,
        received,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

function configFor(port: number, overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    host: '127.0.0.1',
    port,
    user: 'amble',
    password: 'secret-that-must-not-leak',
    from: 'rep@amble.test',
    fromName: 'Amble',
    implicitTls: false,
    timeoutMs: 5_000,
    ...overrides,
  }
}

// ─── The message ──────────────────────────────────────────────────────────

describe('buildMessage', () => {
  const config = configFor(0)

  it('encodes a subject that is not ASCII instead of mangling it', () => {
    const message = buildMessage(config, {
      to: 'someone@example.com',
      subject: 'Tu Rep ha encontrado algo — Halvard',
      text: 'hola',
    })
    assert.match(message, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m)
    assert.ok(!message.includes('encontrado algo —'), 'the raw subject must not go out as bytes')
  })

  it('leaves a plain subject alone, so a normal message reads normally', () => {
    const message = buildMessage(config, {
      to: 'someone@example.com',
      subject: 'Your Rep found something',
      text: 'hi',
    })
    assert.match(message, /^Subject: Your Rep found something$/m)
  })

  it('sends the body as base64, which is what makes dots and long lines safe', () => {
    const body = `${'x'.repeat(400)}\n.\n. a line that starts with a dot`
    const message = buildMessage(config, { to: 'a@b.test', subject: 's', text: body })
    const encoded = message.split('\r\n\r\n')[1]
    assert.equal(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('utf8'), body)
    assert.ok(
      encoded.split('\r\n').every((line) => line.length <= 76),
      'lines stay inside what SMTP will carry',
    )
  })
})

// ─── The conversation ─────────────────────────────────────────────────────

describe('sendMail', () => {
  let server: FakeServer

  before(async () => {
    server = await startServer()
  })
  after(async () => {
    await server.close()
  })

  it('walks the whole exchange in order and hands over the message', async () => {
    await sendMail(configFor(server.port), {
      to: 'borja@example.com',
      subject: 'Your Rep found something',
      text: 'Halvard, Head of Growth & Community.',
    })

    // Only the commands: the message itself goes through the same socket and
    // its headers are not part of the dialogue.
    const verbs = server.received
      .filter((line) => /^(EHLO|STARTTLS|AUTH|MAIL|RCPT|DATA|QUIT) ?/.test(line))
      .map((line) => line.split(/[ :]/)[0])
    assert.deepEqual(verbs, ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'])

    const body = server.received.join('\n')
    assert.match(body, /MAIL FROM:<rep@amble\.test>/)
    assert.match(body, /RCPT TO:<borja@example\.com>/)
    assert.match(body, /Content-Transfer-Encoding: base64/)
  })

  it('says what was refused without ever repeating the credentials', async () => {
    const refusing = await startServer({ AUTH: '535 5.7.8 Authentication credentials invalid' })
    try {
      await assert.rejects(
        sendMail(configFor(refusing.port), { to: 'a@b.test', subject: 's', text: 't' }),
        (error: unknown) => {
          assert.ok(error instanceof SmtpError)
          assert.match(error.message, /535/)
          assert.ok(
            !error.message.includes('secret-that-must-not-leak'),
            'the password must not travel into a job error column',
          )
          return true
        },
      )
    } finally {
      await refusing.close()
    }
  })

  it('reports a rejected recipient rather than reporting success', async () => {
    const refusing = await startServer({ RCPT: '550 5.1.1 No such user here' })
    try {
      await assert.rejects(
        sendMail(configFor(refusing.port), { to: 'nobody@b.test', subject: 's', text: 't' }),
        /550/,
      )
    } finally {
      await refusing.close()
    }
  })

  it('does not try to log in when there is nothing to log in with', async () => {
    const anonymous = await startServer()
    try {
      await sendMail(configFor(anonymous.port, { user: null, password: null }), {
        to: 'a@b.test',
        subject: 's',
        text: 't',
      })
      assert.ok(
        !anonymous.received.some((line) => line.startsWith('AUTH')),
        'an open relay is not a reason to invent a login',
      )
    } finally {
      await anonymous.close()
    }
  })
})
