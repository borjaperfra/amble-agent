import type { Locale } from './i18n/locale'

// The privacy policy lives on amble.fyi, in both languages, with the rest of
// what is public about amble.
export function privacyUrl(locale: Locale): string {
  return locale === 'es' ? 'https://amble.fyi/es/privacy' : 'https://amble.fyi/privacy'
}
