import { AsyncLocalStorage } from 'node:async_hooks'
import { getDb } from '../db/db'
import { candidateById, setCandidateLocale, type CandidateRow } from '../db/repo'
import { dictionaries, type Dictionary } from './dictionaries'
import { DEFAULT_LOCALE, detectLocale, isLocale, localeFromAcceptLanguage, type Locale } from './locale'

// The candidate's language decides the interface and everything the Rep writes.
// Order: what they chose > what their own words show > their browser > English.

export function candidateLocale(candidate: CandidateRow | null, acceptLanguage?: string | null): Locale {
  if (candidate && isLocale(candidate.locale)) return candidate.locale
  return localeFromAcceptLanguage(acceptLanguage ?? null) ?? DEFAULT_LOCALE
}

// Only the candidate's own words count: interview answers, what they said they
// want, and their reasons on offers. A CV or a repository may be in another
// language than the person.
function candidateText(candidateId: string): string[] {
  const db = getDb()
  const rows = [
    ...(db
      .prepare(
        `SELECT t.answer AS text FROM interview_turns t JOIN interviews i ON i.id = t.interview_id
         WHERE i.candidate_id = ? AND t.answer IS NOT NULL`,
      )
      .all(candidateId) as { text: string }[]),
    ...(db.prepare('SELECT raw_answer AS text FROM intent_profiles WHERE candidate_id = ?').all(candidateId) as { text: string }[]),
    ...(db
      .prepare(`SELECT COALESCE(reason, '') || ' ' || COALESCE(conditions, '') AS text FROM offer_probes WHERE candidate_id = ?`)
      .all(candidateId) as { text: string }[]),
  ]
  return rows.map((row) => row.text)
}

// Re-read after the candidate writes something. Never overrides a choice.
export function refreshDetectedLocale(candidateId: string): Locale | null {
  const candidate = candidateById(candidateId)
  if (candidate.locale_source === 'chosen') return isLocale(candidate.locale) ? candidate.locale : null
  const detected = detectLocale(candidateText(candidateId))
  if (detected && detected !== candidate.locale) setCandidateLocale(candidateId, detected, 'detected')
  return detected
}

export function chooseLocale(candidateId: string, locale: Locale): void {
  setCandidateLocale(candidateId, locale, 'chosen')
}

// The language of the request being served. Messages the server writes are
// raised deep inside the pipeline, far from knowing who asked; each request
// sets it once instead of every function carrying it.
const requestLocale = new AsyncLocalStorage<Locale>()

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return requestLocale.run(locale, fn)
}

// Text the server writes for the candidate without the model, in their language.
export function serverText(): Dictionary['server'] {
  return dictionaries[requestLocale.getStore() ?? DEFAULT_LOCALE].server
}
