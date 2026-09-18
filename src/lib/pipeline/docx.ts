import zlib from 'node:zlib'

/**
 * Text out of a .docx, without a dependency.
 *
 * A .docx is a ZIP with the document in `word/document.xml`, and Node already
 * ships the inflate side of it. Reading the two headers we need is less code
 * than a library, has nothing to keep up to date, and works on a laptop with
 * no connection — which is where CVs tend to get handed over.
 *
 * Deliberately not a general ZIP reader: no ZIP64, no encryption, no folder
 * walking. One named entry out of a small archive, or nothing.
 */

const SIGNATURE = {
  endOfCentralDirectory: 0x06054b50,
  centralEntry: 0x02014b50,
  localHeader: 0x04034b50,
} as const

/** The trailer is at the end, after a comment of up to 64KB. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 66_000)
  for (let at = buffer.length - 22; at >= earliest; at -= 1) {
    if (buffer.readUInt32LE(at) === SIGNATURE.endOfCentralDirectory) return at
  }
  return -1
}

export function readZipEntry(buffer: Buffer, wanted: string): Buffer | null {
  if (buffer.length < 22) return null
  const trailer = findEndOfCentralDirectory(buffer)
  if (trailer === -1) return null

  const entryCount = buffer.readUInt16LE(trailer + 10)
  let at = buffer.readUInt32LE(trailer + 16)

  for (let index = 0; index < entryCount; index += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== SIGNATURE.centralEntry) return null

    const method = buffer.readUInt16LE(at + 10)
    const compressedSize = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const localOffset = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)

    if (name === wanted) {
      if (localOffset + 30 > buffer.length) return null
      if (buffer.readUInt32LE(localOffset) !== SIGNATURE.localHeader) return null
      // The local header repeats the name and extra fields at its own lengths.
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const data = buffer.subarray(start, start + compressedSize)
      if (method === 0) return data
      if (method === 8) return zlib.inflateRawSync(data)
      return null
    }

    at += 46 + nameLength + extraLength + commentLength
  }

  return null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * Paragraphs become lines and tabs stay tabs, because a CV's meaning is
 * largely in its layout: role, company, dates, one under the other.
 */
export function docxToText(buffer: Buffer): string {
  let xml: Buffer | null
  try {
    xml = readZipEntry(buffer, 'word/document.xml')
  } catch {
    return ''
  }
  if (!xml) return ''

  return xml
    .toString('utf8')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
