import { getDb } from '../db/db'
import { getOrCreateCandidate, setCandidateLocale } from '../db/repo'
import { DEFAULT_LOCALE, detectLocale, isLocale, localeFromAcceptLanguage, type Locale } from './locale'

// The candidate's language decides the interface and everything the Rep writes.
// Order: what they chose > what their own words show > their browser > English.

export function candidateLocale(acceptLanguage?: string | null): Locale {
  const candidate = getOrCreateCandidate()
  if (isLocale(candidate.locale)) return candidate.locale
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
  const candidate = getOrCreateCandidate()
  if (candidate.locale_source === 'chosen') return isLocale(candidate.locale) ? candidate.locale : null
  const detected = detectLocale(candidateText(candidateId))
  if (detected && detected !== candidate.locale) setCandidateLocale(candidateId, detected, 'detected')
  return detected
}

export function chooseLocale(locale: Locale): void {
  const candidate = getOrCreateCandidate()
  setCandidateLocale(candidate.id, locale, 'chosen')
}
