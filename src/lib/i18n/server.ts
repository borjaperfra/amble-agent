import { cookies, headers } from 'next/headers'
import { currentCandidate } from '../auth/session'
import { candidateLocale } from './candidate'
import { dictionaries, type Dictionary } from './dictionaries'
import { isLocale, type Locale } from './locale'

// Before signing in there is no candidate to ask: the language someone chose
// on the sign-in screen is kept in a cookie.
export const LOCALE_COOKIE = 'amble_locale'

// For Server Components and route handlers.
export async function serverLocale(): Promise<Locale> {
  const acceptLanguage = (await headers()).get('accept-language')
  const candidate = await currentCandidate()
  if (candidate) return candidateLocale(candidate, acceptLanguage)
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(chosen) ? chosen : candidateLocale(null, acceptLanguage)
}

export async function serverDictionary(): Promise<Dictionary> {
  return dictionaries[await serverLocale()]
}
