import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'

// The daily copy, kept off the volume too (Cloudflare R2, S3's API): a copy
// on the disk it copies does not survive losing that disk, and seven of them
// filled it once (2026-10-09). With R2 set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET; a token for that bucket only), each copy
// goes there and only today's stays on the volume; how long R2 keeps them is
// the bucket's lifecycle rule (14 days). Without it, nothing changes.
// Signed by hand (AWS Signature V4), so no SDK comes with it.

export interface OffsiteConfig {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export function offsiteConfig(): OffsiteConfig | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim()
  const bucket = process.env.R2_BUCKET?.trim()
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

// The headers that sign a request to R2: the method, path, a few headers and
// the body's hash, under a key derived from the secret for today.
export function signedHeaders(
  config: OffsiteConfig,
  method: string,
  path: string,
  payloadHash: string,
  at: Date = new Date(),
): Record<string, string> {
  const host = `${config.accountId}.r2.cloudflarestorage.com`
  const amzDate = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/auto/s3/aws4_request`
  const canonical = [method, path, '', `host:${host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${amzDate}`, '', 'host;x-amz-content-sha256;x-amz-date', payloadHash].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return {
    host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  }
}

function objectPath(config: OffsiteConfig, key: string): string {
  return `/${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
}

// A file up as one object (a copy is ~125 MB; R2 takes 5 GB in one go). Read
// whole, so its hash signs it and R2 checks it arrived as it left.
export async function uploadOffsite(config: OffsiteConfig, file: string, key: string): Promise<{ bytes: number }> {
  const body = fs.readFileSync(file)
  const path = objectPath(config, key)
  const headers = signedHeaders(config, 'PUT', path, sha256(body))
  const response = await fetch(`https://${headers.host}${path}`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/gzip' },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (!response.ok) {
    // R2's words say why (a wrong key, a missing bucket); never the secret.
    const detail = (await response.text().catch(() => '')).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? ''
    throw new Error(`R2 answered ${response.status}${detail ? ` (${detail})` : ''}`)
  }
  return { bytes: body.length }
}
