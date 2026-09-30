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

// Macros and ActiveX parts of a .docx, by their entry names.
const DOCX_ACTIVE = /vbaProject\.bin|vbaData\.xml|\/activeX\//

export function activeContent(bytes: Buffer, kind: DocumentKind): string | null {
  const text = bytes.toString('latin1')
  if (kind === 'pdf') {
    const found = text.match(PDF_ACTIVE)
    return found ? `active content (${found[1]})` : null
  }
  return DOCX_ACTIVE.test(text) ? 'macros' : null
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
