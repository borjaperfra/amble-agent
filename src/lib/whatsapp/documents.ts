import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY } from '../db/db'
import { listSources, type CandidateRow } from '../db/repo'
import { candidateLocale, serverText, withLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { takeIntake } from '../limits'
import { TooLargeError } from '../net/safe-fetch'
import { readLaterSource } from '../pipeline/setup'
import { createFileSource, createWebsiteSource, MAX_PDF_BYTES, type SourceCreated } from '../pipeline/sources'
import { mapLink } from './profile'
import { fetchMedia, type ZernioConfig } from './zernio'

// A document sent on WhatsApp (a new CV, their LinkedIn PDF). Fetched from
// the provider at once (WhatsApp drops media after a while), then taken in
// exactly as a file uploaded in the app: the same limits, the same checks on
// what it is from its bytes and on its size, a personal document set aside
// before anything of it is kept, wording meant for a machine taken out. Then
// read into their map as the setup reads a source, and they hear what it
// added, or why it was not used.

export interface SentAttachment {
  type?: string
  url?: string
  mimeType?: string
  filename?: string | null
  payload?: { filename?: string } | null
}

export function isDocument(attachment: SentAttachment): boolean {
  return (attachment.type === 'file' || attachment.type === 'document') && Boolean(attachment.url)
}

// The name it was sent with, as a name and nothing more.
export function documentName(attachment: SentAttachment): string {
  const given = attachment.filename ?? attachment.payload?.filename ?? ''
  const name = path.basename(String(given).replace(/\\/g, '/')).trim().slice(0, 120)
  return name || 'WhatsApp.pdf'
}

function samePdf(sourceId: string, bytes: Buffer): boolean {
  try {
    return fs.readFileSync(path.join(DATA_DIRECTORY, 'uploads', `${sourceId}.original.pdf`)).equals(bytes)
  } catch {
    return false
  }
}

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

export async function takeDocument(candidate: CandidateRow, attachment: SentAttachment, config: ZernioConfig, reply: Reply): Promise<void> {
  const locale = candidateLocale(candidate)
  const w = dictionaries[locale].whatsapp
  // What the checks say to them is in their language.
  return withLocale(locale, async () => {
    // Before anything is fetched: enough sources, or enough tries for today.
    const refused = takeIntake(candidate.id, 'source')
    if (refused) {
      await reply(refused === 'too_many_sources' ? serverText().tooManySources : serverText().tooManyToday)
      return
    }
    let bytes: Buffer | null = null
    try {
      bytes = await fetchMedia(config, attachment.url ?? '', MAX_PDF_BYTES)
    } catch (error) {
      if (error instanceof TooLargeError) {
        await reply(w.documentSetAside(serverText().fileTooLarge))
        return
      }
    }
    if (!bytes) {
      await reply(w.documentUnreadable)
      return
    }

    // The same file again is already on their map. A new one under an old
    // name (an updated "CV.pdf") is a new source, named so.
    let name = documentName(attachment)
    const known = listSources(candidate.id).filter((source) => source.original_filename === name && (source.status === 'extracted' || source.status === 'processed'))
    if (known.some((source) => source.status === 'processed' && samePdf(source.id, bytes))) {
      await reply(w.documentAlready)
      return
    }
    if (known.some((source) => source.status === 'processed')) {
      const extension = path.extname(name)
      name = `${name.slice(0, name.length - extension.length)} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})${extension}`
    }

    const created = await createFileSource(candidate.id, new File([new Uint8Array(bytes)], name, { type: attachment.mimeType ?? '' }))
    if (created.status === 'failed') {
      await reply(w.documentSetAside(created.detail ?? serverText().onlyPdfOrText))
      return
    }
    await readIntoMap(candidate, created, w, reply)
  })
}

// A link to their own work (a portfolio, a project, a post of theirs) that
// the agent told from an offer: taken in as the website given in the setup,
// then read into their map as a document is. The same page twice is not
// read again.
export async function takeLink(candidate: CandidateRow, url: string, reply: Reply): Promise<void> {
  const locale = candidateLocale(candidate)
  const w = dictionaries[locale].whatsapp
  return withLocale(locale, async () => {
    const refused = takeIntake(candidate.id, 'source')
    if (refused) {
      await reply(refused === 'too_many_sources' ? serverText().tooManySources : serverText().tooManyToday)
      return
    }
    const secure = url.replace(/^http:/i, 'https:')
    if (listSources(candidate.id).some((source) => source.status === 'processed' && (source.uri === url || source.uri === secure))) {
      await reply(w.linkAlready)
      return
    }
    const created = await createWebsiteSource(candidate.id, url)
    if (created.status !== 'extracted') {
      await reply(w.documentSetAside(created.detail ?? serverText().websiteUnreadable))
      return
    }
    await readIntoMap(candidate, created, w, reply)
  })
}

// Read into their map as the setup reads a source; they hear what it added,
// or why it was not used.
async function readIntoMap(candidate: CandidateRow, created: SourceCreated, w: (typeof dictionaries)['es']['whatsapp'], reply: Reply): Promise<void> {
  await reply(w.documentReading)
  const read = await readLaterSource(candidate.id, created.id).catch((error: unknown) => {
    console.error('[whatsapp] source not read:', created.id, error instanceof Error ? error.message : error)
    return null
  })
  if (!read) {
    await reply(w.documentFailed)
    return
  }
  if (read.status === 'rejected') {
    await reply(w.documentSetAside(read.reason))
    return
  }
  if (read.claims === 0) {
    await reply(w.documentNothing)
    return
  }
  const text = w.documentRead([...read.added, ...read.raised].slice(0, 4), mapLink(candidate.id))
  // Read without the wording meant for a machine: they hear why it will not be sent on.
  await reply(created.detail === serverText().machineText ? `${text}\n\n${created.detail}` : text)
}
