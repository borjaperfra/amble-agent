// The analysis of a triage refers to its sample offers by number ("#7"),
// which means nothing to whoever reads it later: each one is named by its
// title instead, and a number whose offer is not at hand is taken out.

const OFFER_NUMBER = /#(\d+)/g

export function nameOffers(text: string, titles: Record<number, string>, quote: (title: string) => string): string {
  const named = text.replace(OFFER_NUMBER, (_match, digits: string) => {
    const title = titles[Number(digits)]
    return title ? quote(title) : ''
  })
  if (named === text) return text
  return named
    .replace(/\(\s*(?:[,;]\s*)*\)/g, '')
    .replace(/\s+([,;.)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// How each language quotes a title in running text.
export const quoteTitle: Record<'es' | 'en', (title: string) => string> = {
  es: (title) => `«${title}»`,
  en: (title) => `“${title}”`,
}
