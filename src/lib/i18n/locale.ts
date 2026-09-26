// Shared by server and client: no imports.

export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

// For prompts: the model is told the language by name, not by code.
export const LANGUAGE_NAME: Record<Locale, string> = { en: 'English', es: 'Spanish (Spain)' }

// Short stopwords that dominate running text in each language. Enough to tell
// Spanish from English in a paragraph; not a general language identifier.
const STOPWORDS: Record<Locale, Set<string>> = {
  es: new Set('de la que el en y los las del se por un una con no es lo para pero más mi me yo muy porque también cuando está este esta eso'.split(' ')),
  en: new Set('the and to of a in is it that for with on i my but not this was you are be have at so if'.split(' ')),
}

const MIN_SIGNAL = 12

// Returns null when the text is too short or too mixed to say.
export function detectLocale(texts: string[]): Locale | null {
  const words = texts.join(' ').toLowerCase().match(/[a-záéíóúñü]+/g) ?? []
  const score: Record<Locale, number> = { en: 0, es: 0 }
  for (const word of words) for (const locale of LOCALES) if (STOPWORDS[locale].has(word)) score[locale]++
  const [first, second] = LOCALES.map((locale) => [locale, score[locale]] as const).sort((a, b) => b[1] - a[1])
  if (first[1] < MIN_SIGNAL || first[1] < second[1] * 1.5) return null
  return first[0]
}

export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const code = part.split(';')[0].trim().slice(0, 2).toLowerCase()
    if (isLocale(code)) return code
  }
  return null
}
