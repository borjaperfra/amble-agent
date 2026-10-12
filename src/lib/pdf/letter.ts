// A letter as a PDF (a cover letter to attach to a form): plain words in
// Helvetica on A4, wrapped and paged, with no library. Helvetica is one of
// the fonts every PDF reader carries, so nothing is embedded; its
// WinAnsiEncoding holds Spanish and English (á, ñ, ¿, «, €, –); any other
// character is written as «?».

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 64
const SIZE = 11
const LEADING = 16
const TITLE_SIZE = 14
const LINE_WIDTH = PAGE_WIDTH - 2 * MARGIN
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING)

// Helvetica's widths (thousandths of its size) for ASCII from the space on,
// as its metrics give them; a letter with an accent is as wide as without.
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
]
const WIDE = new Set(['—', '…', '‰', '™', 'Œ', 'œ', 'Æ', 'æ'])

function width(text: string): number {
  let total = 0
  for (const char of text.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
    const code = char.charCodeAt(0)
    total += code >= 32 && code <= 126 ? ASCII_WIDTHS[code - 32] : WIDE.has(char) ? 1000 : 556
  }
  return (total * SIZE) / 1000
}

// Unicode beyond Latin-1 that WinAnsiEncoding places in 0x80–0x9F.
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

// A PDF string of the text, every byte past ASCII as an octal escape, so the
// file stays ASCII and its offsets are its lengths.
function pdfString(text: string): string {
  let out = ''
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 63
    const byte = code < 0x80 ? code : code >= 0xa0 && code <= 0xff ? code : (WIN_ANSI[char] ?? 63)
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`
    else if (byte < 0x20) out += ' '
    else if (byte < 0x80) out += String.fromCharCode(byte)
    else out += `\\${byte.toString(8).padStart(3, '0')}`
  }
  return `(${out})`
}

function wrap(paragraph: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    // A word longer than a line (an address) is cut where the line ends.
    for (let rest = word; rest.length > 0; ) {
      let cut = rest.length
      while (cut > 1 && width(rest.slice(0, cut)) > LINE_WIDTH) cut--
      const piece = rest.slice(0, cut)
      rest = rest.slice(cut)
      if (!line) line = piece
      else if (width(`${line} ${piece}`) <= LINE_WIDTH) line += ` ${piece}`
      else {
        lines.push(line)
        line = piece
      }
    }
  }
  lines.push(line)
  return lines
}

export function letterPdf(params: { title: string | null; text: string }): Buffer {
  const lines = params.text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((paragraph) => (paragraph.trim() ? wrap(paragraph) : ['']))
  const pages: string[][] = []
  // The title takes two lines of the first page.
  for (let at = 0, room = LINES_PER_PAGE - (params.title ? 2 : 0); at < lines.length || pages.length === 0; room = LINES_PER_PAGE) {
    pages.push(lines.slice(at, at + room))
    at += room
  }

  const objects: string[] = []
  const add = (body: string) => objects.push(body) // its number is objects.length
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // the page tree, once the pages have numbers
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  pages.forEach((page, index) => {
    let y = PAGE_HEIGHT - MARGIN
    const ops: string[] = []
    if (index === 0 && params.title) {
      ops.push(`BT /F2 ${TITLE_SIZE} Tf ${MARGIN} ${y} Td ${pdfString(params.title)} Tj ET`)
      y -= 2 * LEADING
    }
    for (const line of page) {
      if (line) ops.push(`BT /F1 ${SIZE} Tf ${MARGIN} ${y} Td ${pdfString(line)} Tj ET`)
      y -= LEADING
    }
    const stream = ops.join('\n')
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const content = objects.length
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`)
    kids.push(objects.length)
  })
  objects[1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`

  let file = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(file.length)
    file += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = file.length
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(file, 'latin1')
}
