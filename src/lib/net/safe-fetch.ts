import dns from 'node:dns'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'
import type { IncomingMessage } from 'node:http'
import { isMaliciousLink } from './reputation'

// Reading a page someone gave us (their website, a link on WhatsApp) without
// letting the link reach what is not public: our own server, the private
// network next to it, a cloud's metadata address. Only https on its usual
// port; every address a name resolves to is checked on the connection itself
// (so a name cannot answer one address to the check and another to the
// request), and again on each redirect. A link known to spread malware
// (reputation.ts) is not followed, nor is a redirect to one. Bounded in time
// and in bytes, and only the kinds of content we read.

export class BlockedUrlError extends Error {}

export interface SafeResponse {
  url: string
  status: number
  contentType: string
  body: string
}

interface Options {
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  contentTypes?: string[]
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  contentTypes: ['text/html', 'application/xhtml+xml', 'text/plain'],
}

// ── Which addresses are public ───────────────────────────────────────────

function v4Parts(address: string): number[] {
  return address.split('.').map(Number)
}

function isPrivateV4(address: string): boolean {
  const [a, b, c] = v4Parts(address)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateV6(address: string): boolean {
  const value = address.toLowerCase()
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateV4(mapped[1])
  return (
    value === '::' ||
    value === '::1' ||
    /^f[cd]/.test(value) ||
    /^fe[89ab]/.test(value) ||
    /^ff/.test(value) ||
    value.startsWith('64:ff9b:') ||
    value.startsWith('::ffff:') ||
    value.startsWith('2001:db8')
  )
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return !isPrivateV4(address)
  if (family === 6) return !isPrivateV6(address)
  return false
}

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|localdomain|home|lan|intranet|corp)$/i

// Why a URL may not be fetched, or null when it may.
export function urlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'not a URL'
  }
  if (url.protocol !== 'https:') return 'only https links'
  if (url.username || url.password) return 'credentials in the URL'
  if (url.port && url.port !== '443') return 'unusual port'
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return isPublicAddress(host) ? null : 'private address'
  if (!host.includes('.') || PRIVATE_NAMES.test(host)) return 'private name'
  return null
}

// The lookup the connection itself uses: an address that is not public ends
// it before a byte is sent.
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4)
    const list = addresses as dns.LookupAddress[]
    const blocked = list.find((item) => !isPublicAddress(item.address))
    if (blocked || list.length === 0) return callback(new BlockedUrlError('private address'), '', 4)
    if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: dns.LookupAddress[]) => void)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

// ── One request ──────────────────────────────────────────────────────────

function request(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers }, lookup: publicLookup, signal }, resolve)
    req.on('error', reject)
  })
}

function readBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase()
  const stream =
    encoding === 'gzip' ? response.pipe(zlib.createGunzip()) : encoding === 'deflate' ? response.pipe(zlib.createInflate()) : encoding === 'br' ? response.pipe(zlib.createBrotliDecompress()) : response
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    // Past the limit the page is cut, not refused: its start is what we read.
    const done = () => resolve(Buffer.concat(chunks, Math.min(size, maxBytes)))
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
      if (size >= maxBytes) {
        response.destroy()
        done()
      }
    })
    stream.on('end', done)
    stream.on('error', (error) => (size >= maxBytes ? done() : reject(error)))
  })
}

export async function safeFetchText(raw: string, options: Options = {}): Promise<SafeResponse> {
  const settings = { ...DEFAULTS, ...options }
  const signal = AbortSignal.timeout(settings.timeoutMs)
  let current = raw
  for (let hop = 0; hop <= settings.maxRedirects; hop++) {
    const problem = urlProblem(current)
    if (problem) throw new BlockedUrlError(problem)
    if (await isMaliciousLink(current)) throw new BlockedUrlError('a link known to spread malware')
    const url = new URL(current)
    const response = await request(url, settings.headers ?? {}, signal)
    const status = response.statusCode ?? 0
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume()
      current = new URL(response.headers.location, url).toString()
      continue
    }
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
    if (status >= 200 && status < 300 && !settings.contentTypes.some((type) => contentType.startsWith(type))) {
      response.destroy()
      throw new BlockedUrlError(`unsupported content type: ${contentType || 'none'}`)
    }
    const body = await readBody(response, settings.maxBytes)
    return { url: current, status, contentType, body: body.toString('utf8') }
  }
  throw new BlockedUrlError('too many redirects')
}
