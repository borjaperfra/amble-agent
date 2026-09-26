'use client'

import { createContext, useContext } from 'react'
import { dictionaries, type Dictionary } from '@/lib/i18n/dictionaries'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale'

// The server decides the locale (it is candidate data); the client picks the
// dictionary, because dictionary entries include functions.
const I18nContext = createContext<{ locale: Locale; t: Dictionary }>({
  locale: DEFAULT_LOCALE,
  t: dictionaries[DEFAULT_LOCALE],
})

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, t: dictionaries[locale] }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export function useT(): Dictionary {
  return useContext(I18nContext).t
}
