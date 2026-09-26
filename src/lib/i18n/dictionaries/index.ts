import type { Locale } from '../locale'
import { en, type Dictionary } from './en'
import { es } from './es'

// Both are small and needed on the client (their entries include functions,
// which cannot cross the server/client boundary), so they are imported
// statically rather than loaded per request.
export const dictionaries: Record<Locale, Dictionary> = { en, es }

export type { Dictionary }
