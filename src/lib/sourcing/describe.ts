import { getDb } from '../db/db'
import { describeOpportunity } from './ats'
import { describeInfoJobs, infoJobsConfigured } from './infojobs'

// Boards that list offers without their text (Workday, SmartRecruiters,
// Factorial) are read in full every pass; an offer's description is fetched
// only when it is about to be judged, and kept.
export async function describeWhenMissing(opportunityId: string): Promise<string | null> {
  const db = getDb()
  const infojobs = db
    .prepare("SELECT external_id FROM opportunity_sources WHERE opportunity_id = ? AND source = 'infojobs' LIMIT 1")
    .get(opportunityId) as { external_id: string } | undefined
  if (infojobs) {
    if (!infoJobsConfigured()) return null
    const text = await describeInfoJobs(infojobs.external_id).catch(() => null)
    if (text) db.prepare('UPDATE opportunities SET description = ? WHERE id = ? AND description IS NULL').run(text, opportunityId)
    return text
  }
  const row = db
    .prepare(
      `SELECT s.source, s.external_id, c.ats_token FROM opportunity_sources s
       JOIN opportunities o ON o.id = s.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE s.opportunity_id = ? AND s.source IN ('workday', 'smartrecruiters', 'factorial') ORDER BY s.last_seen_at DESC LIMIT 1`,
    )
    .get(opportunityId) as { source: string; external_id: string; ats_token: string | null } | undefined
  if (!row?.ats_token) return null
  const description = await describeOpportunity(row.source, row.ats_token, row.external_id).catch(() => null)
  if (description) db.prepare('UPDATE opportunities SET description = ? WHERE id = ? AND description IS NULL').run(description, opportunityId)
  return description
}
