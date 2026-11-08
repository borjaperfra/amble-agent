import { getDb } from './db'
import { now } from './repo'

// Companies someone said they want nothing from (#44): «no me enseñes más de
// Canonical», «ya me rechazaron en Affirm». Kept as a fact, not as a sentence
// for the assessor to weigh, and applied without the model where offers are
// released, shown and sent: one of theirs never comes again, and those
// already waiting go at once. Until a date when it has one (a company that
// turned them down for a year), for good otherwise; undone by them.

export interface ExcludedCompany {
  companyId: string
  name: string
  reason: string | null
  until: string | null
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function excludeCompany(candidateId: string, companyId: string, options: { reason?: string | null; until?: string | null; source: 'offer' | 'chat' }): void {
  getDb()
    .prepare(
      `INSERT INTO excluded_companies (candidate_id, company_id, reason, until, source, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (candidate_id, company_id) DO UPDATE SET reason = excluded.reason, until = excluded.until, source = excluded.source, created_at = excluded.created_at`,
    )
    .run(candidateId, companyId, options.reason?.slice(0, 500) ?? null, options.until ?? null, options.source, now())
}

export function includeCompany(candidateId: string, companyId: string): boolean {
  return Number(getDb().prepare('DELETE FROM excluded_companies WHERE candidate_id = ? AND company_id = ?').run(candidateId, companyId).changes) > 0
}

// The ones that hold today.
export function listExcludedCompanies(candidateId: string): ExcludedCompany[] {
  return (
    getDb()
      .prepare(
        `SELECT e.company_id AS companyId, c.name, e.reason, e.until FROM excluded_companies e JOIN companies c ON c.id = e.company_id
         WHERE e.candidate_id = ? AND (e.until IS NULL OR e.until > ?) ORDER BY e.created_at DESC`,
      )
      .all(candidateId, now()) as unknown as ExcludedCompany[]
  )
}

export function excludedCompanyIds(candidateId: string): Set<string> {
  return new Set(listExcludedCompanies(candidateId).map((row) => row.companyId))
}

// The company they name, among those whose offers amble gave them or judged
// for them: the same name first, then one that contains it or is contained
// in it («Affirm» for «Affirm, Inc.»). Null when nothing of theirs matches.
export function findTheirCompany(candidateId: string, name: string): { id: string; name: string } | null {
  const wanted = norm(name)
  if (!wanted) return null
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT c.id, c.name FROM opportunity_matches m JOIN opportunities o ON o.id = m.opportunity_id
       JOIN companies c ON c.id = o.company_id WHERE m.candidate_id = ?`,
    )
    .all(candidateId) as unknown as { id: string; name: string }[]
  return (
    rows.find((row) => norm(row.name) === wanted) ??
    rows.find((row) => norm(row.name).includes(wanted) || (norm(row.name).length >= 3 && wanted.includes(norm(row.name)))) ??
    null
  )
}

// A year from today, for a company that turned them down and lets nobody
// apply again for that long.
export function aYearFromNow(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString()
}
