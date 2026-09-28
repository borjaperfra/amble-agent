import { headers } from 'next/headers'
import { currentCandidate } from '../auth/session'
import { candidateLocale } from './candidate'
import { dictionaries, type Dictionary } from './dictionaries'
import type { Locale } from './locale'

// For Server Components and route handlers.
export async function serverLocale(): Promise<Locale> {
  const acceptLanguage = (await headers()).get('accept-language')
  return candidateLocale(await currentCandidate(), acceptLanguage)
}

export async function serverDictionary(): Promise<Dictionary> {
  return dictionaries[await serverLocale()]
}
