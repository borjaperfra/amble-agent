import { getDocumentProxy, getResolvedPDFJS } from 'unpdf'

// Which text on a PDF page is drawn so a reader cannot see it: coloured like
// the page (white, or nearly, on nothing darker), fully transparent, or drawn
// in the "invisible" text mode. A scanned CV carries its words invisibly over
// the scan so they can be searched: text over an image is taken as seen, and
// so is white text on a dark band (a sidebar). What is behind the text is
// judged at the point where each run starts: the last fill or image drawn
// there.

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>['getPage']>>
type Matrix = [number, number, number, number, number, number]

export interface InkRun {
  text: string
  hidden: boolean
}

// A channel at or above this (of 255) is as light as the page.
const LIGHT = 235
// Below this opacity, text is not seen.
const MIN_ALPHA = 0.1

type Ink = 'light' | 'ink' | 'none'

interface State {
  ctm: Matrix
  fill: Ink
  stroke: Ink
  fillAlpha: number
  strokeAlpha: number
  mode: number
}

// What was painted on the page, in page space, in the order it was painted.
interface Backdrop {
  box: [number, number, number, number]
  kind: 'image' | Ink
}

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

const apply = (m: Matrix, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]

function boxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number): Backdrop['box'] {
  const corners = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)]
  const xs = corners.map((point) => point[0])
  const ys = corners.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function inkOf(hex: unknown): Ink {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return 'ink'
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
  return channels.every((channel) => channel >= LIGHT) ? 'light' : 'ink'
}

const asMatrix = (value: unknown): Matrix | null => {
  const list = value ? Array.from(value as ArrayLike<number>) : []
  return list.length === 6 && list.every(Number.isFinite) ? (list as Matrix) : null
}

let opsCache: Record<string, number> | null = null

export async function inkRuns(page: Page): Promise<InkRun[]> {
  opsCache ??= (await getResolvedPDFJS()).OPS as unknown as Record<string, number>
  const OPS = opsCache
  const list = await page.getOperatorList()
  const FILLS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.rawFillPath])
  const IMAGES = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintImageXObjectRepeat,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintSolidColorImageMask,
  ])
  const SHOW = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText])

  let state: State = { ctm: [1, 0, 0, 1, 0, 0], fill: 'ink', stroke: 'ink', fillAlpha: 1, strokeAlpha: 1, mode: 0 }
  const stack: State[] = []
  const backdrops: Backdrop[] = []
  let line: Matrix = [1, 0, 0, 1, 0, 0]
  let leading = 0
  const runs: InkRun[] = []

  const behind = (x: number, y: number): Backdrop['kind'] | null => {
    for (let index = backdrops.length - 1; index >= 0; index--) {
      const [x0, y0, x1, y1] = backdrops[index].box
      if (x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1) return backdrops[index].kind
    }
    return null
  }

  const seen = (ink: Ink, alpha: number, under: Backdrop['kind'] | null) => {
    if (ink === 'none' || alpha < MIN_ALPHA) return false
    if (ink === 'ink') return true
    // Light ink shows only on something that is not light itself.
    return under === 'image' || under === 'ink'
  }

  for (let index = 0; index < list.fnArray.length; index++) {
    const fn = list.fnArray[index]
    const args = (list.argsArray[index] ?? []) as unknown[]
    switch (fn) {
      case OPS.save:
        stack.push({ ...state })
        break
      case OPS.restore:
        state = stack.pop() ?? state
        break
      case OPS.transform: {
        const m = asMatrix(args)
        if (m) state.ctm = multiply(m, state.ctm)
        break
      }
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...state })
        const m = asMatrix(args[0])
        if (m) state.ctm = multiply(m, state.ctm)
        break
      }
      case OPS.paintFormXObjectEnd:
        state = stack.pop() ?? state
        break
      case OPS.setGState:
        for (const entry of (args[0] ?? []) as [string, unknown][]) {
          if (entry[0] === 'ca' && typeof entry[1] === 'number') state.fillAlpha = entry[1]
          if (entry[0] === 'CA' && typeof entry[1] === 'number') state.strokeAlpha = entry[1]
        }
        break
      case OPS.setFillRGBColor:
        state.fill = inkOf(args[0])
        break
      case OPS.setStrokeRGBColor:
        state.stroke = inkOf(args[0])
        break
      case OPS.setFillTransparent:
        state.fill = 'none'
        break
      case OPS.setStrokeTransparent:
        state.stroke = 'none'
        break
      // A pattern or a colour pdf.js did not turn into RGB: taken as ink.
      case OPS.setFillColorN:
      case OPS.setFillColor:
        state.fill = 'ink'
        break
      case OPS.setTextRenderingMode:
        state.mode = Number(args[0]) || 0
        break
      case OPS.constructPath: {
        const box = args[2] ? Array.from(args[2] as ArrayLike<number>) : []
        if (FILLS.has(args[0] as number) && box.length === 4 && box.every(Number.isFinite)) {
          backdrops.push({ box: boxOf(state.ctm, box[0], box[1], box[2], box[3]), kind: state.fillAlpha < MIN_ALPHA ? 'none' : state.fill })
        }
        break
      }
      case OPS.shadingFill:
        // A gradient over what is clipped: its bounds are not known here.
        backdrops.push({ box: [-Infinity, -Infinity, Infinity, Infinity], kind: 'image' })
        break
      case OPS.beginText:
        line = [1, 0, 0, 1, 0, 0]
        break
      case OPS.setTextMatrix: {
        const m = asMatrix(args[0]) ?? asMatrix(args)
        if (m) line = m
        break
      }
      case OPS.setLeading:
        leading = Number(args[0]) || 0
        break
      case OPS.moveText:
      case OPS.setLeadingMoveText: {
        const [x, y] = [Number(args[0]) || 0, Number(args[1]) || 0]
        if (fn === OPS.setLeadingMoveText) leading = -y
        line = multiply([1, 0, 0, 1, x, y], line)
        break
      }
      case OPS.nextLine:
        line = multiply([1, 0, 0, 1, 0, -leading], line)
        break
      default:
        if (IMAGES.has(fn)) backdrops.push({ box: boxOf(state.ctm, 0, 0, 1, 1), kind: 'image' })
    }
    if (SHOW.has(fn)) {
      if (fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) line = multiply([1, 0, 0, 1, 0, -leading], line)
      const glyphs = (fn === OPS.nextLineSetSpacingShowText ? args[2] : args[0]) as unknown
      const text = Array.isArray(glyphs)
        ? glyphs.map((glyph) => (glyph && typeof glyph === 'object' && 'unicode' in glyph ? String((glyph as { unicode: unknown }).unicode ?? '') : '')).join('')
        : ''
      if (!text.trim()) continue
      const [x, y] = apply(state.ctm, line[4], line[5])
      const under = behind(x, y)
      const mode = state.mode % 4
      const hidden =
        mode === 3 ||
        (mode === 0 && !seen(state.fill, state.fillAlpha, under)) ||
        (mode === 1 && !seen(state.stroke, state.strokeAlpha, under)) ||
        (mode === 2 && !seen(state.fill, state.fillAlpha, under) && !seen(state.stroke, state.strokeAlpha, under))
      // Invisible text over a scan is how a scanned page can be searched.
      runs.push({ text, hidden: hidden && !(mode === 3 && under === 'image') })
    }
  }
  return runs
}

const comparable = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')

// A page's text items split into what is seen and what is not, from the runs
// the page drew (an item already known to be hidden, too small or off the
// page, stays hidden). When the items line up character for character with
// the runs, each character goes where its run says; when they do not (a font
// without Unicode, reordered text), the hidden runs are taken out of the
// page's text by their wording.
export interface PageItem {
  text: string
  hidden: boolean
}

export function splitByInk(items: PageItem[], runs: InkRun[]): { visible: string; hidden: string } {
  const hiddenRuns = runs.filter((run) => run.hidden)
  const flags: boolean[] = []
  for (const run of runs) flags.push(...Array<boolean>([...comparable(run.text)].length).fill(run.hidden))
  const total = items.reduce((sum, item) => sum + [...comparable(item.text)].length, 0)
  let visible = ''
  let hidden = ''
  if (hiddenRuns.length === 0 || flags.length !== total) {
    for (const item of items) {
      if (item.hidden) hidden += `${item.text} `
      else visible += item.text
    }
    visible = visible.replace(/\s+/g, ' ')
    for (const run of hiddenRuns) {
      const wording = run.text.replace(/\s+/g, ' ').trim()
      if (wording.length >= 3) visible = visible.replaceAll(wording, ' ')
      hidden += `${run.text} `
    }
    return { visible, hidden }
  }
  let position = 0
  let last = false
  for (const item of items) {
    for (const character of item.text) {
      const width = [...comparable(character)].length
      // Spacing goes with the text before it.
      if (width > 0) {
        last = item.hidden || flags.slice(position, position + width).some(Boolean)
        position += width
      }
      if (last) hidden += character
      else visible += character
    }
    if (item.hidden) hidden += ' '
  }
  return { visible, hidden }
}
