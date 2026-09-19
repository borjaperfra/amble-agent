/**
 * Enough SMTP to send one message, and no more.
 *
 * A mail library would be three hundred kilobytes and a supply chain for
 * something this project does exactly once: tell a person that one job is
 * worth their evening. The protocol underneath is a dozen commands and
 * three-digit replies, and Node already brings the two sockets it needs.
 *
 * What is deliberately not here: attachments, HTML alternatives, pooling,
 * DKIM signing, queueing. Retries live on the job queue with everything else
 * that talks to a network, so a server that is down at midnight is the same
 * kind of problem as a model that times out.
 */

import net from 'node:net'
import tls from 'node:tls'
import type { SmtpConfig } from '@/lib/features'

export interface Mail {
  to: string
  subject: string
  /** Plain text. Base64 on the wire, so line length and dots stop mattering. */
  text: string
}

export class SmtpError extends Error {
  /** The reply code, when the server got far enough to give one. */
  readonly code: number | null

  constructor(message: string, code: number | null = null) {
    super(message)
    this.name = 'SmtpError'
    this.code = code
  }

  /**
   * A 5xx is the server saying no, not the server being busy — a bad
   * recipient, a refused sender, a message it will never take. Retrying that
   * for ten minutes achieves nothing except burying the reason under four
   * more attempts. 4xx is "try later" and is exactly what the queue is for.
   */
  get permanent(): boolean {
    return this.code !== null && this.code >= 500 && this.code < 600
  }
}

interface Reply {
  code: number
  text: string
}

// ─── The message ──────────────────────────────────────────────────────────

/** RFC 2047, because "Tu Rep ha encontrado algo" is not ASCII. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function wrap(value: string, width = 76): string {
  const lines: string[] = []
  for (let at = 0; at < value.length; at += width) lines.push(value.slice(at, at + width))
  return lines.join('\r\n')
}

export function buildMessage(config: SmtpConfig, mail: Mail, now = new Date()): string {
  const headers = [
    `From: ${encodeHeader(config.fromName)} <${config.from}>`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${now.getTime().toString(36)}.${Math.random().toString(36).slice(2, 10)}@amble>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ]
  return `${headers.join('\r\n')}\r\n\r\n${wrap(Buffer.from(mail.text, 'utf8').toString('base64'))}\r\n`
}

// ─── The conversation ─────────────────────────────────────────────────────

/**
 * One socket, one exchange of commands.
 *
 * A reply can span several lines: every line but the last separates its code
 * from the text with a hyphen. Reading until the space is the whole trick,
 * and getting it wrong means reading a capability list as a response to the
 * next command.
 */
class Session {
  private socket: net.Socket | tls.TLSSocket
  private buffer = ''
  private waiting: ((reply: Reply | Error) => void) | null = null
  private failure: Error | null = null

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket
    this.listen()
  }

  private listen() {
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk
      this.flush()
    })
    this.socket.on('error', (error) => this.fail(error))
    this.socket.on('close', () => this.fail(new SmtpError('The server closed the connection.')))
  }

  private fail(error: Error) {
    this.failure = error
    const waiting = this.waiting
    this.waiting = null
    waiting?.(error)
  }

  private take(): Reply | null {
    const lines = this.buffer.split('\r\n')
    for (let index = 0; index < lines.length; index += 1) {
      // A space after the code, rather than a hyphen, ends the reply.
      if (/^\d{3} /.test(lines[index])) {
        const used = lines.slice(0, index + 1)
        this.buffer = lines.slice(index + 1).join('\r\n')
        return {
          code: Number.parseInt(used[used.length - 1].slice(0, 3), 10),
          text: used.map((line) => line.slice(4)).join(' ').trim(),
        }
      }
    }
    return null
  }

  private flush() {
    if (!this.waiting) return
    const reply = this.take()
    if (!reply) return
    const waiting = this.waiting
    this.waiting = null
    waiting(reply)
  }

  read(): Promise<Reply> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure)
      this.waiting = (result) => (result instanceof Error ? reject(result) : resolve(result))
      this.flush()
    })
  }

  write(line: string) {
    this.socket.write(`${line}\r\n`)
  }

  /** Send a command and insist on the code it is supposed to come back with. */
  async command(line: string, expected: number, redact = false): Promise<Reply> {
    this.write(line)
    const reply = await this.read()
    if (Math.floor(reply.code / 100) !== Math.floor(expected / 100)) {
      const shown = redact ? line.split(' ')[0] : line
      throw new SmtpError(`${shown} was refused: ${reply.code} ${reply.text}`, reply.code)
    }
    return reply
  }

  /** Swap this session's socket for the TLS one wrapped around it. */
  upgrade(socket: tls.TLSSocket) {
    this.socket.removeAllListeners('data')
    this.socket.removeAllListeners('error')
    this.socket.removeAllListeners('close')
    this.buffer = ''
    this.socket = socket
    this.listen()
  }

  end() {
    this.socket.end()
  }
}

function connect(config: SmtpConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = config.implicitTls
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.connect({ host: config.host, port: config.port })

    const done = (error?: Error) => {
      socket.removeListener('error', onError)
      if (error) {
        socket.destroy()
        reject(error)
      } else {
        resolve(socket)
      }
    }
    const onError = (error: Error) => done(error)

    socket.setTimeout(config.timeoutMs, () =>
      done(new SmtpError(`No answer from ${config.host}:${config.port}.`)),
    )
    socket.once('error', onError)
    socket.once(config.implicitTls ? 'secureConnect' : 'connect', () => done())
  })
}

function startTls(socket: net.Socket, config: SmtpConfig): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: config.host }, () => resolve(secure))
    secure.once('error', reject)
  })
}

/**
 * Send it, or throw with what the server said.
 *
 * Credentials never reach the error message: a failed AUTH reports the verb
 * and the code, not the line, because these end up in a job's `last_error`
 * and that column is read by a human looking for what went wrong.
 */
export async function sendMail(config: SmtpConfig, mail: Mail): Promise<void> {
  const socket = await connect(config)
  const session = new Session(socket)
  const greeting = await session.read()
  if (Math.floor(greeting.code / 100) !== 2) {
    session.end()
    throw new SmtpError(`The server did not want to talk: ${greeting.code} ${greeting.text}`, greeting.code)
  }

  try {
    let capabilities = await session.command(`EHLO amble`, 250)

    if (!config.implicitTls && /STARTTLS/i.test(capabilities.text)) {
      await session.command('STARTTLS', 220)
      session.upgrade(await startTls(socket as net.Socket, config))
      // The capability list before the upgrade does not count; AUTH is
      // usually only offered once the line is encrypted.
      capabilities = await session.command(`EHLO amble`, 250)
    }

    if (config.user && config.password) {
      if (/AUTH[ =-][^\r\n]*PLAIN/i.test(capabilities.text)) {
        const token = Buffer.from(`\0${config.user}\0${config.password}`, 'utf8').toString('base64')
        await session.command(`AUTH PLAIN ${token}`, 235, true)
      } else {
        await session.command('AUTH LOGIN', 334, true)
        await session.command(Buffer.from(config.user, 'utf8').toString('base64'), 334, true)
        await session.command(Buffer.from(config.password, 'utf8').toString('base64'), 235, true)
      }
    }

    await session.command(`MAIL FROM:<${config.from}>`, 250)
    await session.command(`RCPT TO:<${mail.to}>`, 250)
    await session.command('DATA', 354)
    session.write(buildMessage(config, mail).replace(/\r\n\./g, '\r\n..').trimEnd())
    await session.command('.', 250)
    // The message is accepted at the dot; QUIT is manners. Waiting for the
    // 221 means the socket closes after the server is done rather than in
    // the middle of it, which some servers log as an aborted transaction.
    session.write('QUIT')
    await session.read().catch(() => undefined)
  } finally {
    session.end()
  }
}
