import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { DATA_DIRECTORY, getDb } from '@/lib/db/db'
import { safeFetchBytes } from '@/lib/net/safe-fetch'

export const runtime = 'nodejs'

// A company's logo for the offers (#41): its site's icon, fetched once by
// amble from the company's domain and kept on the volume, so the person's
// browser never asks a third party. Without one, the page shows the
// company's initials. Small: a few KB each, a few hundred companies.

const LOGOS = path.join(DATA_DIRECTORY, 'cache', 'logos')
const MAX_BYTES = 200 * 1024
const TIMEOUT_MS = 5000
// A company without an icon is asked again after this long.
const RETRY_MS = 7 * 24 * 60 * 60 * 1000
const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i

function served(body: Buffer, type: string) {
  return new NextResponse(new Uint8Array(body), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800, immutable' } })
}

const none = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=86400' } })

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  if (!/^[\w-]{1,80}$/.test(companyId)) return none()
  const file = path.join(LOGOS, `${companyId}.png`)
  const missing = path.join(LOGOS, `${companyId}.none`)
  if (fs.existsSync(file)) return served(fs.readFileSync(file), 'image/png')
  if (fs.existsSync(missing) && Date.now() - fs.statSync(missing).mtimeMs < RETRY_MS) return none()

  const row = getDb().prepare('SELECT domain FROM companies WHERE id = ?').get(companyId) as { domain: string | null } | undefined
  const domain = row?.domain?.trim().replace(/^www\./i, '') ?? ''
  if (!DOMAIN.test(domain)) return none()
  fs.mkdirSync(LOGOS, { recursive: true })
  try {
    const icon = await safeFetchBytes(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS })
    // Unknown sites get a 404 with a generic globe: that is no logo.
    if (icon.status !== 200 || !icon.contentType.startsWith('image/') || icon.body.length < 200) throw new Error(`no icon (${icon.status})`)
    fs.writeFileSync(file, icon.body)
    fs.rmSync(missing, { force: true })
    return served(icon.body, icon.contentType)
  } catch {
    fs.writeFileSync(missing, '')
    return none()
  }
}
