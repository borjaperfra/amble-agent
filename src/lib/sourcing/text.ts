// Small, dependency-free text helpers for job postings.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bull: '•',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

const MAX_DESCRIPTION_CHARS = 30_000

// Greenhouse returns HTML that is itself entity-encoded, so decoding runs
// before and after stripping tags.
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const text = decodeEntities(
    decodeEntities(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, MAX_DESCRIPTION_CHARS) : null
}

export function clampText(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed.slice(0, MAX_DESCRIPTION_CHARS) : null
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|gmbh|sas|sl|s\.l\.|ai labs)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Tracking parameters and trailing slashes make one posting look like many.
export function normaliseUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gh_src|source|ref|lever-)/i.test(key)) parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase()
  } catch {
    return null
  }
}

export function inferWorkplace(...hints: (string | null | undefined)[]): 'remote' | 'hybrid' | 'onsite' | null {
  const text = hints.filter(Boolean).join(' ').toLowerCase()
  if (!text) return null
  if (/\bhybrid\b|\bhíbrido\b/.test(text)) return 'hybrid'
  if (/\bremote\b|\bremoto\b|\banywhere\b|\bdistributed\b/.test(text)) return 'remote'
  if (/\bon-?site\b|\bin[- ]office\b|\bpresencial\b/.test(text)) return 'onsite'
  return null
}
