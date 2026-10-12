import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { DATA_DIRECTORY, getDb } from '@/lib/db/db'
import { safeFetchBytes, safeFetchText } from '@/lib/net/safe-fetch'

export const runtime = 'nodejs'

// A company's logo for the offers (#41): its site's own icon, fetched once by
// amble and kept on the volume, so the person's browser never asks a third
// party. Sharp or nothing: the large icon sites publish for phones
// (apple-touch-icon), else the largest icon their home page names, else a
// public favicon service; under 64 px it would show pixelated at 44, and the
// page shows the company's initials instead. A few KB each.

const LOGOS = path.join(DATA_DIRECTORY, 'cache', 'logos')
// v2: sharp icons only (v1 kept 32 px ones that showed pixelated).
const VERSION = 'v2'
const MAX_BYTES = 300 * 1024
const PAGE_BYTES = 512 * 1024
const TIMEOUT_MS = 4000
const MIN_SIZE = 64
// A company without one is asked again after this long.
const RETRY_MS = 7 * 24 * 60 * 60 * 1000
const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i

type Kind = 'image/png' | 'image/jpeg' | 'image/webp'

// What the bytes are, whatever the server said; and a PNG's width and height.
function kindOf(body: Buffer): Kind | null {
  if (body.length > 24 && body.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8) return 'image/jpeg'
  if (body.length > 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function sharp(body: Buffer): boolean {
  const kind = kindOf(body)
  if (!kind) return false
  if (kind !== 'image/png') return body.length > 2000
  return Math.min(body.readUInt32BE(16), body.readUInt32BE(20)) >= MIN_SIZE
}

async function fetchIcon(url: string): Promise<Buffer | null> {
  try {
    const icon = await safeFetchBytes(url, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS })
    return icon.status === 200 && sharp(icon.body) ? icon.body : null
  } catch {
    return null
  }
}

// The icons the home page names, largest first.
async function pageIcons(domain: string): Promise<string[]> {
  try {
    const page = await safeFetchText(`https://${domain}`, { maxBytes: PAGE_BYTES, timeoutMs: TIMEOUT_MS, contentTypes: ['text/html'] })
    const found: { href: string; size: number }[] = []
    for (const tag of page.body.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
      const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
      if (!href || !/icon/.test(rel) || /\.svg(\?|$)/i.test(href)) continue
      const size = Number(tag.match(/\bsizes\s*=\s*["'](\d+)x\d+/i)?.[1] ?? (/apple-touch/.test(rel) ? 180 : 0))
      try {
        found.push({ href: new URL(href, page.url).toString(), size })
      } catch {
        // A malformed address is skipped.
      }
    }
    return found.sort((a, b) => b.size - a.size).map((item) => item.href).filter((href) => href.startsWith('https://'))
  } catch {
    return []
  }
}

async function findLogo(domain: string): Promise<Buffer | null> {
  for (const url of [`https://${domain}/apple-touch-icon.png`, `https://www.${domain}/apple-touch-icon.png`]) {
    const icon = await fetchIcon(url)
    if (icon) return icon
  }
  for (const url of (await pageIcons(domain)).slice(0, 3)) {
    const icon = await fetchIcon(url)
    if (icon) return icon
  }
  return fetchIcon(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`)
}

function served(body: Buffer) {
  return new NextResponse(new Uint8Array(body), {
    headers: { 'Content-Type': kindOf(body) ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=604800, immutable' },
  })
}

const none = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=86400' } })

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  if (!/^[\w-]{1,80}$/.test(companyId)) return none()
  const file = path.join(LOGOS, `${companyId}.${VERSION}`)
  const missing = `${file}.none`
  if (fs.existsSync(file)) return served(fs.readFileSync(file))
  if (fs.existsSync(missing) && Date.now() - fs.statSync(missing).mtimeMs < RETRY_MS) return none()

  const row = getDb().prepare('SELECT domain FROM companies WHERE id = ?').get(companyId) as { domain: string | null } | undefined
  const domain = row?.domain?.trim().replace(/^www\./i, '') ?? ''
  if (!DOMAIN.test(domain)) return none()
  fs.mkdirSync(LOGOS, { recursive: true })
  const logo = await findLogo(domain)
  if (!logo) {
    fs.writeFileSync(missing, '')
    return none()
  }
  fs.writeFileSync(file, logo)
  fs.rmSync(missing, { force: true })
  return served(logo)
}
