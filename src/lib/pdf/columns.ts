import { getDocumentProxy } from 'unpdf'

// Whether a CV is laid out in two columns (#55): a sidebar beside the main
// text, as many CV templates do. A filter that reads text in plain lines
// reads both columns mixed, line by line. Told only when it is clear: most
// lines of a page split in two by a wide gap near the middle, not a date
// pushed to the right of a single column.

interface Item {
  str: string
  x: number
  y: number
  width: number
}

// A gap this wide (of the page's width) between two runs on one line.
const MIN_GAP = 0.06
// Where the second column may start: a date at the right edge is not one.
const SPLIT_FROM = 0.25
const SPLIT_TO = 0.7
// A page is in two columns when this share of its lines are split, and at
// least this many.
const MIN_SHARE = 0.35
const MIN_LINES = 12

export function splitLine(items: Item[], pageWidth: number): boolean {
  const sorted = items.filter((item) => item.str.trim()).sort((a, b) => a.x - b.x)
  for (let i = 1; i < sorted.length; i++) {
    const end = Math.max(...sorted.slice(0, i).map((item) => item.x + item.width))
    const start = sorted[i].x
    const right = sorted.slice(i).map((item) => item.str).join(' ').trim()
    if ((start - end) / pageWidth >= MIN_GAP && start / pageWidth >= SPLIT_FROM && start / pageWidth <= SPLIT_TO && right.split(/\s+/).length >= 2) {
      return true
    }
  }
  return false
}

export function pageInColumns(items: Item[], pageWidth: number): boolean {
  const lines = new Map<number, Item[]>()
  for (const item of items) {
    if (!item.str.trim()) continue
    const key = Math.round(item.y / 3)
    lines.set(key, [...(lines.get(key) ?? []), item])
  }
  const all = [...lines.values()]
  const split = all.filter((line) => splitLine(line, pageWidth)).length
  return split >= MIN_LINES && split / all.length >= MIN_SHARE
}

export async function pdfInColumns(bytes: Buffer): Promise<boolean> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    let pages = 0
    let inColumns = 0
    for (let n = 1; n <= Math.min(pdf.numPages, 4); n++) {
      const page = await pdf.getPage(n)
      const width = page.getViewport({ scale: 1 }).width
      const content = await page.getTextContent()
      const items = content.items.flatMap((raw) =>
        'str' in raw ? [{ str: raw.str, x: raw.transform[4], y: raw.transform[5], width: raw.width }] : [],
      )
      if (items.length === 0) continue
      pages++
      if (pageInColumns(items, width)) inColumns++
    }
    // Most of its pages, and the first.
    return pages > 0 && inColumns * 2 > pages
  } catch {
    return false
  }
}
