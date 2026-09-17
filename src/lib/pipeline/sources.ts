import fs from 'node:fs'
import path from 'node:path'
import { extractText, getDocumentProxy } from 'unpdf'
import { DATA_DIRECTORY } from '../db/db'
import {
  insertClaim,
  insertSource,
  listSources,
  newId,
  parseJsonArray,
  setCandidateNameIfEmpty,
  updateSourceStatus,
  type SourceRow,
} from '../db/repo'
import { runExtractClaimsTask } from '../model/tasks'

const MAX_CONTENT_CHARS = 60_000

export interface SourceCreated {
  id: string
  name: string
  type: string
  status: string
  detail: string | null
}

async function extractPdfText(buffer: Buffer): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const result = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(result.text) ? result.text : [result.text]
  return pages.map((page) => page.replace(/\s+/g, ' ').trim())
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
  const isPdf = file.type === 'application/pdf' || extension === '.pdf'
  const isText = ['.txt', '.md', '.markdown'].includes(extension) || file.type.startsWith('text/')
  const textName = `${id}.txt`
  const storedPath = path.join(DATA_DIRECTORY, 'uploads', textName)

  if (!isPdf && !isText) {
    return {
      id,
      name: originalName,
      type: 'cv',
      status: 'failed',
      detail: 'I can only read PDF or plain text files in this build.',
    }
  }

  fs.mkdirSync(path.dirname(storedPath), { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  if (isPdf) {
    fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', `${id}.original.pdf`), buffer)
  }

  let content = ''
  try {
    if (isPdf) {
      const pages = await extractPdfText(buffer)
      content = pages.map((page, index) => `[page ${index + 1}] ${page}`).join('\n\n')
    } else {
      content = buffer.toString('utf8')
    }
  } catch {
    return {
      id,
      name: originalName,
      type: 'cv',
      status: 'failed',
      detail: "I couldn't read any text from this file. It may be a scanned document.",
    }
  }

  content = content.replace(/\s+\[page/g, '\n\n[page').trim()
  if (content.replace(/\[page \d+\]/g, '').trim().length < 120) {
    return {
      id,
      name: originalName,
      type: 'cv',
      status: 'failed',
      detail:
        "I couldn't find enough readable text in this document. If it's scanned, try a text-based PDF or a plain text export.",
    }
  }

  fs.writeFileSync(storedPath, content, 'utf8')

  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: 'cv',
    name: originalName,
    uri: null,
    original_filename: originalName,
    mime_type: isPdf ? 'application/pdf' : file.type || 'text/plain',
    stored_path: textName,
    char_count: content.length,
    status: 'extracted',
    status_detail: null,
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Amble/0.1 (source ingestion)' },
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.startsWith('text/')) {
      throw new Error(`unsupported content type: ${contentType}`)
    }
    content = stripHtml(await response.text())
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
      status_detail: `I couldn't read this website (${error instanceof Error ? error.message : 'unknown reason'}). Your Rep stored the URL only.`,
    })
    return {
      id,
      name: hostname,
      type: 'website',
      status: 'registered',
      detail: "I couldn't read this website. The URL is stored, but I couldn't read its text.",
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
      status_detail: 'The page loaded but contained almost no readable text.',
    })
    return {
      id,
      name: hostname,
      type: 'website',
      status: 'registered',
      detail: 'The page loaded but contained almost no readable text.',
    }
  }

  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: 'website',
    name: hostname,
    uri: url,
    original_filename: null,
    mime_type: 'text/html',
    stored_path: null,
    char_count: content.length,
    status: 'extracted',
    status_detail: null,
  })
  fs.mkdirSync(path.join(DATA_DIRECTORY, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', `${id}.txt`), content)
  return { id: source.id, name: source.name, type: source.type, status: source.status, detail: null }
}

export function createGitHubSource(candidateId: string, url: string): SourceCreated {
  const id = newId('src')
  const handle = url
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\/.*$/, '')
    .trim()
  const name = handle || url
  const source = insertSource({
    id,
    candidate_id: candidateId,
    type: 'github',
    name,
    uri: `https://github.com/${name}`,
    original_filename: null,
    mime_type: null,
    stored_path: null,
    char_count: 0,
    status: 'registered',
    status_detail: "GitHub reading isn't supported in this build yet. The profile is stored, not read.",
  })
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    detail: "GitHub reading isn't supported in this build yet. The profile is stored, not read.",
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
    status_detail: "LinkedIn reading isn't supported in this build. The URL is stored, not read.",
  })
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    detail: "LinkedIn reading isn't supported in this build. The URL is stored, not read.",
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

export async function processSource(source: SourceRow, candidateId: string): Promise<ProcessedSourceResult> {
  const content = readSourceContent(source)
  if (!content) {
    updateSourceStatus(source.id, 'failed', 'The stored source content could not be loaded.')
    throw new Error(`The content of "${source.name}" could not be loaded.`)
  }

  const { data } = await runExtractClaimsTask({
    candidateId: source.candidate_id,
    sourceName: source.name,
    sourceType: source.type,
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
    .map((claim) => {
      const parts = claim.statement.split(/\s+(?:at|for|on)\s+/i)
      const title = parts.length > 1 ? parts[parts.length - 1].slice(0, 48) : claim.statement.slice(0, 48)
      return { title, meta: claim.statement.length > 64 ? `${claim.statement.slice(0, 64)}…` : claim.statement }
    })

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
