import { getDb, inTransaction } from '../db/db'
import { ASSESS_SAME_RULES } from './assess'
import { waitingToRelease } from './release'
import { currentMatchKey } from './run'

// What is next to be shown to someone, judged again when the assessor's
// rules changed since (ASSESS_SAME_RULES): its judgment under their
// current key goes, and the pass's read judges it again with the rules of
// now. Only what has not reached them yet (not released, answered or sent
// on WhatsApp): what they have seen stays as they saw it. A few at a time,
// in the order they would be released, always ahead of the three a day.

export const RECHECK_PER_PASS = 20

export function recheckNextReleases(candidateId: string, limit: number = RECHECK_PER_PASS): number {
  const db = getDb()
  let key: string
  // No profile yet: nothing judged to look at again.
  try {
    key = currentMatchKey(candidateId)
  } catch {
    return 0
  }
  const judgment = db.prepare(
    `SELECT m.id, m.model_run_id, r.task_version FROM opportunity_matches m LEFT JOIN model_runs r ON r.id = m.model_run_id
     WHERE m.candidate_id = ? AND m.opportunity_id = ? AND m.profile_hash = ?`,
  )
  // Every posting of the role, judged together: judged again together, and
  // only when none of them has reached them (another city's posting of it
  // released, answered or sent).
  const role = db.prepare(
    `SELECT m.id, m.opportunity_id, m.response,
       EXISTS (SELECT 1 FROM offer_sends s WHERE s.candidate_id = m.candidate_id AND s.match_id = m.id) AS sent,
       EXISTS (SELECT 1 FROM offer_releases r WHERE r.candidate_id = m.candidate_id AND r.opportunity_id = m.opportunity_id) AS released,
       EXISTS (SELECT 1 FROM opportunity_decisions d WHERE d.candidate_id = m.candidate_id AND d.opportunity_id = m.opportunity_id) AS decided
     FROM opportunity_matches m WHERE m.candidate_id = ? AND m.profile_hash = ? AND m.model_run_id = ?`,
  )
  const remove = db.prepare('DELETE FROM opportunity_matches WHERE id = ?')
  const runs = new Set<string>()
  for (const item of waitingToRelease(candidateId)) {
    if (runs.size >= limit) break
    const row = judgment.get(candidateId, item.opportunityId, key) as { id: string; model_run_id: string | null; task_version: string | null } | undefined
    if (!row?.model_run_id || runs.has(row.model_run_id)) continue
    if (ASSESS_SAME_RULES.has((row.task_version ?? '').split('@')[0])) continue
    runs.add(row.model_run_id)
  }
  let removed = 0
  inTransaction(() => {
    for (const run of runs) {
      const postings = role.all(candidateId, key, run) as { id: string; response: string | null; sent: number; released: number; decided: number }[]
      if (postings.some((posting) => posting.response !== null || posting.sent || posting.released || posting.decided)) continue
      for (const { id } of postings) removed += Number(remove.run(id).changes)
    }
  })
  return removed
}
