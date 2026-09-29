import { getDb } from './db'
import { newId, now } from './repo'
import { normaliseName, normaliseTitle, normaliseUrl } from '../sourcing/text'
import type { RawOpportunity } from '../sourcing/types'

export type CompanyStatus = 'watching' | 'unresolved' | 'ignored'

export interface CompanyRow {
  id: string
  name: string
  name_norm: string
  domain: string | null
  careers_url: string | null
  ats: string | null
  ats_token: string | null
  status: CompanyStatus
  discovered_via: string
  last_fetched_at: string | null
  last_error: string | null
  created_at: string
  segment: string | null
  public_salary: number
}

export interface OpportunityRow {
  id: string
  company_id: string
  title: string
  title_norm: string
  location: string | null
  workplace: string | null
  url: string | null
  url_norm: string | null
  description: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_raw: string | null
  posted_at: string | null
  first_seen_at: string
  last_seen_at: string
  closed_at: string | null
}

// ── Companies ────────────────────────────────────────────────────────────

export function getCompanyByName(name: string): CompanyRow | undefined {
  return getDb().prepare('SELECT * FROM companies WHERE name_norm = ?').get(normaliseName(name)) as unknown as CompanyRow | undefined
}

export function getCompany(id: string): CompanyRow | undefined {
  return getDb().prepare('SELECT * FROM companies WHERE id = ?').get(id) as unknown as CompanyRow | undefined
}

// Keeps what is already known: a later, poorer sighting (an aggregator that
// only knows the name) never erases an ATS that was resolved before.
export function upsertCompany(params: {
  name: string
  domain?: string | null
  careersUrl?: string | null
  ats?: string | null
  atsToken?: string | null
  status: CompanyStatus
  discoveredVia: string
}): CompanyRow {
  const db = getDb()
  const existing = getCompanyByName(params.name)
  if (existing) {
    db.prepare(
      `UPDATE companies SET
         domain = COALESCE(domain, ?), careers_url = COALESCE(?, careers_url),
         ats = COALESCE(?, ats), ats_token = COALESCE(?, ats_token),
         status = CASE WHEN status = 'ignored' THEN status WHEN ? = 'watching' THEN 'watching' ELSE status END
       WHERE id = ?`,
    ).run(params.domain ?? null, params.careersUrl ?? null, params.ats ?? null, params.atsToken ?? null, params.status, existing.id)
    return getCompany(existing.id) as CompanyRow
  }
  const id = newId('co')
  db.prepare(
    `INSERT INTO companies (id, name, name_norm, domain, careers_url, ats, ats_token, status, discovered_via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.name.trim(),
    normaliseName(params.name),
    params.domain ?? null,
    params.careersUrl ?? null,
    params.ats ?? null,
    params.atsToken ?? null,
    params.status,
    params.discoveredVia,
    now(),
  )
  return getCompany(id) as CompanyRow
}

// upsertCompany never forgets a board; a refresh that no longer finds one does.
export function clearCompanyBoard(id: string): void {
  getDb().prepare("UPDATE companies SET ats = NULL, ats_token = NULL, status = 'unresolved' WHERE id = ? AND status != 'ignored'").run(id)
}

export function setCompanyDirectoryInfo(id: string, segment: string, publicSalary: boolean): void {
  getDb().prepare('UPDATE companies SET segment = ?, public_salary = ? WHERE id = ?').run(segment, publicSalary ? 1 : 0, id)
}

export function listCompanies(status?: CompanyStatus): CompanyRow[] {
  if (status) {
    return getDb().prepare('SELECT * FROM companies WHERE status = ? ORDER BY name_norm').all(status) as unknown as CompanyRow[]
  }
  return getDb().prepare('SELECT * FROM companies ORDER BY name_norm').all() as unknown as CompanyRow[]
}

export function setCompanyStatus(id: string, status: CompanyStatus): void {
  getDb().prepare('UPDATE companies SET status = ? WHERE id = ?').run(status, id)
}

export function recordCompanyFetch(id: string, error: string | null): void {
  getDb().prepare('UPDATE companies SET last_fetched_at = ?, last_error = ? WHERE id = ?').run(now(), error, id)
}

// ── Opportunities ────────────────────────────────────────────────────────

function findOpportunity(raw: RawOpportunity, companyId: string, urlNorm: string | null): OpportunityRow | undefined {
  const db = getDb()
  const bySource = db
    .prepare('SELECT o.* FROM opportunity_sources s JOIN opportunities o ON o.id = s.opportunity_id WHERE s.source = ? AND s.external_id = ?')
    .get(raw.source, raw.externalId) as unknown as OpportunityRow | undefined
  if (bySource) return bySource
  if (urlNorm) {
    const byUrl = db.prepare('SELECT * FROM opportunities WHERE url_norm = ?').get(urlNorm) as unknown as OpportunityRow | undefined
    if (byUrl) return byUrl
  }
  // Same company, same title, same place: the same offer seen from two sources.
  // Location is part of the key because one role is often open in several cities.
  return db
    .prepare(
      `SELECT * FROM opportunities
       WHERE company_id = ? AND title_norm = ? AND COALESCE(lower(location), '') = COALESCE(lower(?), '') AND closed_at IS NULL`,
    )
    .get(companyId, normaliseTitle(raw.title), raw.location) as unknown as OpportunityRow | undefined
}

export function recordSighting(raw: RawOpportunity, companyId: string, seenAt: string): { opportunityId: string; created: boolean } {
  const db = getDb()
  const urlNorm = normaliseUrl(raw.url)
  const existing = findOpportunity(raw, companyId, urlNorm)
  let opportunityId: string
  let created = false

  if (existing) {
    opportunityId = existing.id
    // The richest description wins; missing facts are filled, never overwritten.
    const description =
      raw.description && (!existing.description || raw.description.length > existing.description.length) ? raw.description : existing.description
    db.prepare(
      `UPDATE opportunities SET
         description = ?, location = COALESCE(location, ?), workplace = COALESCE(workplace, ?),
         url = COALESCE(url, ?), url_norm = COALESCE(url_norm, ?),
         salary_min = COALESCE(salary_min, ?), salary_max = COALESCE(salary_max, ?),
         salary_currency = COALESCE(salary_currency, ?), salary_raw = COALESCE(salary_raw, ?),
         posted_at = CASE WHEN posted_at IS NULL OR (? IS NOT NULL AND ? < posted_at) THEN ? ELSE posted_at END,
         last_seen_at = ?, closed_at = NULL
       WHERE id = ?`,
    ).run(
      description,
      raw.location,
      raw.workplace,
      raw.url,
      urlNorm,
      raw.salaryMin,
      raw.salaryMax,
      raw.salaryCurrency,
      raw.salaryRaw,
      raw.postedAt,
      raw.postedAt,
      raw.postedAt,
      seenAt,
      opportunityId,
    )
  } else {
    opportunityId = newId('opp')
    created = true
    db.prepare(
      `INSERT INTO opportunities (id, company_id, title, title_norm, location, workplace, url, url_norm, description,
         salary_min, salary_max, salary_currency, salary_raw, posted_at, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opportunityId,
      companyId,
      raw.title,
      normaliseTitle(raw.title),
      raw.location,
      raw.workplace,
      raw.url,
      urlNorm,
      raw.description,
      raw.salaryMin,
      raw.salaryMax,
      raw.salaryCurrency,
      raw.salaryRaw,
      raw.postedAt,
      seenAt,
      seenAt,
    )
  }

  db.prepare(
    `INSERT INTO opportunity_sources (source, external_id, opportunity_id, url, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, closed_at = NULL, url = COALESCE(excluded.url, url)`,
  ).run(raw.source, raw.externalId, opportunityId, raw.url, seenAt, seenAt)

  return { opportunityId, created }
}

// Only for sources that list a company's complete board (ATSs). An offer
// missing from a successful full read has closed there. The offer itself
// closes when no source still lists it.
export function closeMissing(companyId: string, source: string, seenExternalIds: Set<string>, closedAt: string): number {
  const db = getDb()
  const open = db
    .prepare(
      `SELECT s.external_id, s.opportunity_id FROM opportunity_sources s JOIN opportunities o ON o.id = s.opportunity_id
       WHERE o.company_id = ? AND s.source = ? AND s.closed_at IS NULL`,
    )
    .all(companyId, source) as unknown as { external_id: string; opportunity_id: string }[]
  let closed = 0
  for (const row of open) {
    if (seenExternalIds.has(row.external_id)) continue
    db.prepare('UPDATE opportunity_sources SET closed_at = ? WHERE source = ? AND external_id = ?').run(closedAt, source, row.external_id)
    const stillOpen = db
      .prepare('SELECT 1 FROM opportunity_sources WHERE opportunity_id = ? AND closed_at IS NULL')
      .get(row.opportunity_id)
    if (!stillOpen) {
      db.prepare('UPDATE opportunities SET closed_at = ? WHERE id = ?').run(closedAt, row.opportunity_id)
      closed++
    }
  }
  return closed
}

export function countOpportunities(): { open: number; closed: number; companies: number } {
  const db = getDb()
  const open = (db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE closed_at IS NULL').get() as { n: number }).n
  const closed = (db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE closed_at IS NOT NULL').get() as { n: number }).n
  const companies = (db.prepare("SELECT COUNT(*) AS n FROM companies WHERE status = 'watching'").get() as { n: number }).n
  return { open, closed, companies }
}

// Every open offer without its text: the text of thousands of offers is
// tens of megabytes, and a pass only reads it for the few it judges
// (descriptionsOf). Several passes and first reads can then run at once.
export function listOpenOpportunities(): (Omit<OpportunityRow, 'description'> & { company_name: string })[] {
  const columns = (getDb().prepare('PRAGMA table_info(opportunities)').all() as unknown as { name: string }[])
    .map((column) => column.name)
    .filter((name) => name !== 'description')
  return getDb()
    .prepare(
      `SELECT ${columns.map((name) => `o.${name}`).join(', ')}, c.name AS company_name FROM opportunities o
       JOIN companies c ON c.id = o.company_id
       WHERE o.closed_at IS NULL AND c.status != 'ignored' ORDER BY o.first_seen_at DESC`,
    )
    .all() as unknown as (Omit<OpportunityRow, 'description'> & { company_name: string })[]
}

export function descriptionsOf(opportunityIds: string[]): Map<string, string> {
  if (opportunityIds.length === 0) return new Map()
  const rows = getDb()
    .prepare(
      `SELECT id, description FROM opportunities WHERE description IS NOT NULL AND id IN (${opportunityIds.map(() => '?').join(', ')})`,
    )
    .all(...opportunityIds) as unknown as { id: string; description: string }[]
  return new Map(rows.map((row) => [row.id, row.description]))
}

// ── Runs ─────────────────────────────────────────────────────────────────

export function startSourcingRun(): string {
  const id = newId('run')
  getDb().prepare('INSERT INTO sourcing_runs (id, started_at) VALUES (?, ?)').run(id, now())
  return id
}

// When the aggregator was last searched, whatever it returned.
export function lastTheirStackSearchAt(): string | null {
  const row = getDb()
    .prepare("SELECT started_at FROM sourcing_runs WHERE json_extract(stats, '$.theirstack.ran') = 1 ORDER BY started_at DESC LIMIT 1")
    .get() as { started_at: string } | undefined
  return row?.started_at ?? null
}

export function finishSourcingRun(id: string, stats: unknown, errors: unknown[]): void {
  getDb()
    .prepare('UPDATE sourcing_runs SET finished_at = ?, stats = ?, errors = ? WHERE id = ?')
    .run(now(), JSON.stringify(stats), JSON.stringify(errors), id)
}
