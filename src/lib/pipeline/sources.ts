import fs from 'node:fs'
import path from 'node:path'
import { extractText, getDocumentProxy } from 'unpdf'
import { DATA_DIRECTORY, getDb } from '../db/db'
import { documentKind, isPlainText } from '../files'
import { safeFetchText } from '../net/safe-fetch'
import {
  insertClaim,
  insertSource,
  listSources,
  newId,
  parseJsonArray,
  setCandidateNameIfEmpty,
  updateSourceStatus,
  updateSourceType,
  type SourceRow,
} from '../db/repo'
import { runExtractClaimsTask } from '../model/tasks'
import { serverText } from '../i18n/candidate'
import { classifySourceContent, detectSourceSignature } from './classify'
import { buildGitHubDigest, GitHubError, parseGitHubHandle, type GitHubDigest } from './github'

const MAX_CONTENT_CHARS = 60_000

export interface SourceCreated {
  id: string
  name: string
  type: string
  status: string
  detail: string | null
}

// A CV fits well within these; a file past them is something else, or made
// to keep the server busy.
export const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_PDF_PAGES = 20
const PDF_READ_MS = 15_000

class TooManyPagesError extends Error {}

async function extractPdfText(buffer: Buffer): Promise<string[]> {
  const read = (async () => {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    if (pdf.numPages > MAX_PDF_PAGES) throw new TooManyPagesError()
    const result = await extractText(pdf, { mergePages: false })
    const pages = Array.isArray(result.text) ? result.text : [result.text]
    return pages.map((page) => page.replace(/\s+/g, ' ').trim())
  })()
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PDF took too long to read')), PDF_READ_MS)
  })
  try {
    return await Promise.race([read, late])
  } finally {
    clearTimeout(timer)
  }
}

// The files of a source that was set aside or failed: nothing of it is kept
// beyond its name and why (an ID card or a medical report uploaded by mistake
// must not stay on disk).
export function discardSourceFiles(sourceId: string): void {
  const uploads = path.join(DATA_DIRECTORY, 'uploads')
  for (const name of [`${sourceId}.txt`, `${sourceId}.original.pdf`]) fs.rmSync(path.join(uploads, name), { force: true })
  getDb().prepare('UPDATE sources SET stored_path = NULL, char_count = 0 WHERE id = ?').run(sourceId)
}

// Once a day: files of sources set aside or failed, and files no source
// points at (older uploads kept a PDF before knowing it could be read).
// Files younger than an hour are left, in case one is being written.
export function sweepUploads(): { discarded: number; orphans: number } {
  const uploads = path.join(DATA_DIRECTORY, 'uploads')
  if (!fs.existsSync(uploads)) return { discarded: 0, orphans: 0 }
  const db = getDb()
  const setAside = db.prepare("SELECT id FROM sources WHERE status IN ('rejected', 'failed') AND stored_path IS NOT NULL").all() as { id: string }[]
  for (const { id } of setAside) discardSourceFiles(id)
  const known = new Set((db.prepare('SELECT id FROM sources').all() as { id: string }[]).map((row) => row.id))
  let orphans = 0
  for (const name of fs.readdirSync(uploads)) {
    const file = path.join(uploads, name)
    if (known.has(name.split('.')[0]) || Date.now() - fs.statSync(file).mtimeMs < 60 * 60 * 1000) continue
    fs.rmSync(file, { force: true })
    orphans++
  }
  return { discarded: setAside.length, orphans }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function createFileSource(
  candidateId: string,
  file: File,
): Promise<SourceCreated> {
  const originalName = file.name || 'upload'
  const existing = listSources(candidateId).find(
    (source) =>
      source.original_filename === originalName &&
      (source.status === 'extracted' || source.status === 'processed'),
  )
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      type: existing.type,
      status: existing.status,
      detail: null,
    }
  }

  const id = newId('src')
  const extension = path.extname(originalName).toLowerCase()
  const textName = `${id}.txt`
  const storedPath = path.join(DATA_DIRECTORY, 'uploads', textName)
  const failed = (detail: string): SourceCreated => ({ id, name: originalName, type: 'cv', status: 'failed', detail })

  if (file.size > MAX_PDF_BYTES) return failed(serverText().fileTooLarge)
  const buffer = Buffer.from(await file.arrayBuffer())
  // What it is comes from its bytes; the name and the browser's type only claim it.
  const isPdf = documentKind(buffer) === 'pdf'
  const isText = !isPdf && ['.txt', '.md', '.markdown'].includes(extension) && buffer.length <= MAX_TEXT_BYTES && isPlainText(buffer)
  if (!isPdf && !isText) return failed(serverText().onlyPdfOrText)

  let content = ''
  try {
    if (isPdf) {
      const pages = await extractPdfText(buffer)
      content = pages.map((page, index) => `[page ${index + 1}] ${page}`).join('\n\n')
    } else {
      content = buffer.toString('utf8')
    }
  } catch (error) {
    if (error instanceof TooManyPagesError) return failed(serverText().fileTooLarge)
    return {
      id,
      name: originalName,
      type: 'cv',
      status: 'failed',
      detail: serverText().noTextInFile,
    }
  }

  content = content.replace(/\s+\[page/g, '\n\n[page').trim()
  if (content.replace(/\[page \d+\]/g, '').trim().length < 120) {
    return {
      id,
      name: originalName,
      type: 'cv',
      status: 'failed',
      detail: serverText().notEnoughText,
    }
  }

  // Only now, read and long enough, is anything of it kept.
  fs.mkdirSync(path.dirname(storedPath), { recursive: true })
  if (isPdf) fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', `${id}.original.pdf`), buffer)
  fs.writeFileSync(storedPath, content, 'utf8')

  // What a file is comes from its content, not from the field it was dropped into.
  // The free, deterministic check runs here; the model confirms at processing time.
  const signature = detectSourceSignature(content)

  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: signature?.type ?? 'cv',
    name: originalName,
    uri: null,
    original_filename: originalName,
    mime_type: isPdf ? 'application/pdf' : file.type || 'text/plain',
    stored_path: textName,
    char_count: content.length,
    status: 'extracted',
    status_detail: signature?.describe() ?? null,
  })

  return { id: source.id, name: source.name, type: source.type, status: source.status, detail: null }
}

export async function createWebsiteSource(candidateId: string, url: string): Promise<SourceCreated> {
  const id = newId('src')
  const hostname = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })()

  let content = ''
  try {
    // Only https: a site given without it, or on http, is asked for over https.
    const secure = /^https?:\/\//i.test(url) ? url.replace(/^http:/i, 'https:') : `https://${url}`
    const response = await safeFetchText(secure, { headers: { 'User-Agent': 'Amble/0.1 (source ingestion)' }, timeoutMs: 15_000 })
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
    content = stripHtml(response.body)
  } catch (error) {
    insertSource({
      id,
      candidate_id: candidateId,
      type: 'website',
      name: hostname,
      uri: url,
      original_filename: null,
      mime_type: null,
      stored_path: null,
      char_count: 0,
      status: 'registered',
      status_detail: serverText().websiteUnreadableDetail(error instanceof Error ? error.message : '?'),
    })
    return {
      id,
      name: hostname,
      type: 'website',
      status: 'registered',
      detail: serverText().websiteUnreadable,
    }
  }

  if (content.length < 200) {
    insertSource({
      id,
      candidate_id: candidateId,
      type: 'website',
      name: hostname,
      uri: url,
      original_filename: null,
      mime_type: null,
      stored_path: null,
      char_count: content.length,
      status: 'registered',
      status_detail: serverText().websiteEmpty,
    })
    return {
      id,
      name: hostname,
      type: 'website',
      status: 'registered',
      detail: serverText().websiteEmpty,
    }
  }

  const textName = `${id}.txt`
  fs.mkdirSync(path.join(DATA_DIRECTORY, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', textName), content)
  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: 'website',
    name: hostname,
    uri: url,
    original_filename: null,
    mime_type: 'text/html',
    stored_path: textName,
    char_count: content.length,
    status: 'extracted',
    status_detail: null,
  })
  return { id: source.id, name: source.name, type: source.type, status: source.status, detail: null }
}

export async function createGitHubSource(candidateId: string, url: string): Promise<SourceCreated> {
  const id = newId('src')
  const handle = parseGitHubHandle(url) ?? url.trim()

  let digest: GitHubDigest
  try {
    digest = await buildGitHubDigest(url)
  } catch (error) {
    // Registering without reading is honest; pretending to have read is not.
    const reason =
      error instanceof GitHubError
        ? error.message
        : serverText().githubUnreadable
    insertSource({
      id,
      candidate_id: candidateId,
      type: 'github',
      name: handle,
      uri: `https://github.com/${handle}`,
      original_filename: null,
      mime_type: null,
      stored_path: null,
      char_count: 0,
      status: 'registered',
      status_detail: reason,
    })
    return { id, name: handle, type: 'github', status: 'registered', detail: reason }
  }

  const textName = `${id}.txt`
  fs.mkdirSync(path.join(DATA_DIRECTORY, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', textName), digest.content, 'utf8')

  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: 'github',
    name: digest.handle,
    uri: `https://github.com/${digest.handle}`,
    original_filename: null,
    mime_type: 'text/plain',
    stored_path: textName,
    char_count: digest.content.length,
    status: 'extracted',
    status_detail: serverText().githubRead(digest.repoCount, digest.ownCommitCount),
  })

  if (digest.displayName) setCandidateNameIfEmpty(candidateId, digest.displayName)

  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    detail: source.status_detail,
  }
}

export function createLinkedInSource(candidateId: string, url: string): SourceCreated {
  const id = newId('src')
  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: 'linkedin',
    name: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    uri: url,
    original_filename: null,
    mime_type: null,
    stored_path: null,
    char_count: 0,
    status: 'registered',
    status_detail: serverText().linkedinUnsupported,
  })
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    detail: serverText().linkedinUnsupported,
  }
}

export function readSourceContent(source: SourceRow): string {
  if (!source.stored_path) return ''
  const filePath = path.join(DATA_DIRECTORY, 'uploads', path.basename(source.stored_path))
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

export interface ProcessedSourceResult {
  sourceId: string
  sourceName: string
  claimsCount: number
  discoveries: { title: string; meta: string }[]
}

export class SourceRejectedError extends Error {
  constructor(public readonly sourceName: string, public readonly reason: string) {
    super(`"${sourceName}" isn't professional evidence: ${reason}`)
    this.name = 'SourceRejectedError'
  }
}

export async function processSource(source: SourceRow, candidateId: string): Promise<ProcessedSourceResult> {
  const content = readSourceContent(source)
  if (!content) {
    updateSourceStatus(source.id, 'failed', serverText().sourceNotLoaded)
    throw new Error(serverText().sourceNotLoaded)
  }

  // Classify before extracting. A document that isn't about this person's career
  // must never reach claim extraction: it would produce fluent, sourced nonsense.
  let resolvedType = source.type
  if (source.type !== 'website') {
    const classification = await classifySourceContent({ candidateId, content })
    if (!classification.isProfessional) {
      updateSourceStatus(source.id, 'rejected', classification.reason)
      discardSourceFiles(source.id)
      throw new SourceRejectedError(source.name, classification.reason)
    }
    if (classification.type !== 'other' && classification.type !== resolvedType) {
      updateSourceType(source.id, classification.type)
      resolvedType = classification.type
    }
  }

  const { data } = await runExtractClaimsTask({
    candidateId: source.candidate_id,
    sourceName: source.name,
    sourceType: resolvedType,
    content: content.slice(0, MAX_CONTENT_CHARS),
  })

  if (data.candidateName) {
    setCandidateNameIfEmpty(source.candidate_id, data.candidateName)
  }

  for (const claim of data.claims) {
    insertClaim({
      id: newId('clm'),
      candidate_id: candidateId,
      source_id: source.id,
      interview_turn_id: null,
      statement: claim.statement,
      claim_type: claim.claimType,
      epistemic_state: claim.epistemicState,
      source_excerpt: claim.sourceExcerpt,
      source_location: claim.sourceLocation ?? null,
      confidence: claim.confidence,
      requires_confirmation: claim.requiresConfirmation ? 1 : 0,
      possible_capabilities: JSON.stringify(claim.possibleCapabilities),
    })
  }

  updateSourceStatus(source.id, 'processed', null)

  const discoveries = data.claims
    .filter((claim) => claim.claimType === 'experience' || claim.claimType === 'project')
    .slice(0, 6)
    // The statement itself, once: a title cut from it only repeated it.
    .map((claim) => ({ title: claim.statement.length > 160 ? `${claim.statement.slice(0, 157)}…` : claim.statement, meta: '' }))

  return {
    sourceId: source.id,
    sourceName: source.name,
    claimsCount: data.claims.length,
    discoveries,
  }
}

export function claimCapabilitySuggestions(possibleCapabilitiesJson: string): string[] {
  return parseJsonArray(possibleCapabilitiesJson)
}
