import { inflateRawSync } from 'node:zlib'

// What a file someone gives is, from its bytes: the type a browser sends and
// the extension are only what the file claims to be. And whether it carries
// something that runs when it is opened, which a CV never needs and which
// would go on, in their name and amble's, to a company's systems.

export type DocumentKind = 'pdf' | 'docx'

export function documentKind(bytes: Buffer): DocumentKind | null {
  // A PDF may have a little junk before its header; readers accept 1 KB of it.
  if (bytes.subarray(0, 1024).includes('%PDF-')) return 'pdf'
  // A .docx is a zip whose entry names (stored uncompressed) include the document.
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && bytes.includes('word/document.xml')) return 'docx'
  return null
}

// Names that make a PDF act when opened (scripts, launching programs, files
// inside it, forms that run code). /URI links are ordinary in a CV and pass.
// Names inside compressed object streams are not seen: this is a first gate,
// not a scanner.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)(?![A-Za-z])/

export function activeContent(bytes: Buffer, kind: DocumentKind): string | null {
  if (kind === 'docx') return docxProblem(bytes)
  const found = bytes.toString('latin1').match(PDF_ACTIVE)
  return found ? `active content (${found[1]})` : null
}

// ── .docx ────────────────────────────────────────────────────────────────
// A .docx is a zip of XML parts and the relationships between them. What
// makes one act when opened: macros and ActiveX parts; a relationship to
// something outside the file (a template, an image or an object fetched from
// a server, which tells that server who opened it, or brings in what it
// wants); another document poured in whole (altChunk); a field that runs a
// program or pulls in a remote file (DDE, INCLUDETEXT). Links a person clicks
// are ordinary and pass. The zip is read from its own directory and unpacked
// within a budget: a small file that unpacks to gigabytes is refused on the way.

const MAX_ENTRIES = 2_000
const MAX_UNPACKED = 64 * 1024 * 1024
const MAX_RATIO = 200

interface ZipEntry {
  name: string
  method: number
  compressed: number
  size: number
  offset: number
}

class ZipError extends Error {}

function zipEntries(bytes: Buffer): ZipEntry[] {
  // The end record is in the last 64 KB (22 bytes plus a comment).
  const floor = Math.max(0, bytes.length - 22 - 0xffff)
  let end = -1
  for (let at = bytes.length - 22; at >= floor; at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new ZipError('no directory')
  const count = bytes.readUInt16LE(end + 10)
  const directorySize = bytes.readUInt32LE(end + 12)
  let at = bytes.readUInt32LE(end + 16)
  // Zip64 (past 4 GB or 65,535 entries) is not something a CV needs.
  if (count === 0xffff || at === 0xffffffff || count > MAX_ENTRIES) throw new ZipError('too many entries')
  if (at + directorySize > end) throw new ZipError('directory out of bounds')
  const entries: ZipEntry[] = []
  let total = 0
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new ZipError('bad directory entry')
    const flags = bytes.readUInt16LE(at + 8)
    const method = bytes.readUInt16LE(at + 10)
    const compressed = bytes.readUInt32LE(at + 20)
    const size = bytes.readUInt32LE(at + 24)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    const offset = bytes.readUInt32LE(at + 42)
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1')
    if (flags & 0x1) throw new ZipError('encrypted')
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError('zip64')
    if (method !== 0 && method !== 8) throw new ZipError('unknown compression')
    total += size
    if (total > MAX_UNPACKED || (size > 1024 * 1024 && size > compressed * MAX_RATIO)) throw new ZipError('too large unpacked')
    entries.push({ name, method, compressed, size, offset })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function unpack(bytes: Buffer, entry: ZipEntry): Buffer {
  const at = entry.offset
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04034b50) throw new ZipError('bad entry')
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28)
  const data = bytes.subarray(start, start + entry.compressed)
  if (data.length !== entry.compressed) throw new ZipError('entry out of bounds')
  if (entry.method === 0) return data
  // Never more than the directory says it holds: a lying header stops here.
  return inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) })
}

// The only relationship a .docx may have outside itself: a link a person clicks.
const HYPERLINK = /\/hyperlink$/
const TEMPLATE = /\/attachedTemplate$/
const LOCAL_PATH = /^(file:\/\/\/)?[a-z]:[\\/]/i
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/i
// Parts that are other programs or other documents, even kept inside.
const EMBEDDED_TYPE = /\/(oleObject|control|aFChunk|subDocument|frame)$/i
// Macros, ActiveX and embedded objects, by their entry names. A chart keeps
// its data as a spreadsheet inside (which cannot carry macros); anything else
// embedded is another program's file.
const DOCX_ACTIVE = /vbaProject\.bin$|vbaData\.xml$|(^|\/)activeX\/|(^|\/)embeddings\/(?![^/]+\.xlsx$)/i
// Fields that run something or fetch something when the document is opened.
const ACTIVE_FIELD = /\b(DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|IMPORT|LINK)\b/

function attribute(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find((value) => value !== undefined) ?? ''
}

function docxProblem(bytes: Buffer): string | null {
  let entries: ZipEntry[]
  try {
    entries = zipEntries(bytes)
  } catch (error) {
    return error instanceof ZipError && error.message === 'too large unpacked' ? 'a file far larger once unpacked' : 'a damaged file'
  }
  if (entries.some((entry) => DOCX_ACTIVE.test(entry.name))) return 'macros or embedded objects'
  try {
    for (const entry of entries) {
      const isRels = entry.name.endsWith('.rels')
      const isPart = /^word\/[^/]+\.xml$/i.test(entry.name) || entry.name === '[Content_Types].xml'
      if (!isRels && !isPart) continue
      const xml = unpack(bytes, entry).toString('utf8')
      if (entry.name === '[Content_Types].xml') {
        if (/macroEnabled|vbaProject|activeX/i.test(xml)) return 'macros or embedded objects'
        continue
      }
      if (isRels) {
        for (const tag of xml.match(/<(\w+:)?Relationship\b[^>]*>/g) ?? []) {
          const type = attribute(tag, 'Type')
          if (EMBEDDED_TYPE.test(type)) return 'embedded or linked documents'
          if (!/^external$/i.test(attribute(tag, 'TargetMode'))) continue
          // Word records the template a document was made from, often a path
          // on the author's own disk: only one on a server is fetched from afar.
          if (TEMPLATE.test(type) && LOCAL_PATH.test(attribute(tag, 'Target').trim())) continue
          if (!HYPERLINK.test(type)) return 'content fetched from outside the file'
          if (!SAFE_LINK.test(attribute(tag, 'Target').trim())) return 'links to files outside the web'
        }
        continue
      }
      if (/<w:altChunk\b/.test(xml)) return 'embedded or linked documents'
      // The code of a field: in <w:instrText> runs, or a simple field's w:instr.
      const fieldCode = [
        ...[...xml.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g)].map((match) => match[1]),
        ...[...xml.matchAll(/\bw:instr\s*=\s*"([^"]*)"/g)].map((match) => match[1]),
      ].join(' ')
      if (ACTIVE_FIELD.test(fieldCode.toUpperCase())) return 'fields that run or fetch something'
    }
  } catch {
    return 'a file far larger once unpacked, or damaged'
  }
  return null
}

// Plain text is UTF-8 without NUL bytes; anything else is a binary file
// wearing a .txt name.
export function isPlainText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}
