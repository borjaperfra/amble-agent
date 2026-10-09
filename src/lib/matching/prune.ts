import { getDb, inTransaction } from '../db/db'
import { ASSESS_VERSION } from './assess'
import { currentMatchKey } from './run'

// Judgments no screen and no carry-over will read again. Each change to a
// person's profile gives their offers a new key, and the offers are judged
// (or carried) under it: the earlier rows stayed, the same reasons written
// again each time, and by 2026-10-09 half of the 55,000 rows were of keys no
// longer anyone's. What still reads earlier keys:
//   - the offers screen and carry-over take, for an offer the current key
//     has not judged, the latest earlier judgment of the same assessor
//     version (view.ts, carry.ts): the latest of each offer stays;
//   - the first read's quarter of an hour (release.ts): only two weeks old
//     and older go;
//   - what they answered, and what was sent on WhatsApp (offer_sends and its
//     buttons carry the row's id): never touched;
//   - an offer shown or held is kept after it closes (retention.ts): such a
//     row goes only when a newer one also shows or holds it.
// So a row goes when it is not under their current key, is two weeks old,
// was not answered or sent, and either a newer judgment of the offer stands
// (or a copy of it under a newer key), or it was a discard by an assessor
// version nothing reads any more.

const DAY_MS = 24 * 60 * 60 * 1000
export const PRUNE_AFTER_DAYS = 14

export function pruneEarlierMatches(at: number = Date.now()): { deleted: number } {
  const db = getDb()
  const before = new Date(at - PRUNE_AFTER_DAYS * DAY_MS).toISOString()
  const candidates = db.prepare('SELECT DISTINCT candidate_id FROM opportunity_matches').all() as unknown as { candidate_id: string }[]
  const remove = db.prepare(
    `DELETE FROM opportunity_matches AS m
     WHERE m.candidate_id = ? AND m.profile_hash != ? AND m.created_at < ? AND m.response IS NULL
       AND NOT EXISTS (SELECT 1 FROM offer_sends s WHERE s.candidate_id = m.candidate_id AND s.match_id = m.id)
       AND (
         EXISTS (
           SELECT 1 FROM opportunity_matches c
           WHERE c.candidate_id = m.candidate_id AND c.opportunity_id = m.opportunity_id AND c.profile_hash != m.profile_hash
             AND (c.created_at > m.created_at OR c.carried_from = m.profile_hash)
             AND (m.verdict = 'discarded' OR c.verdict IN ('show', 'hold'))
         )
         OR (m.verdict = 'discarded' AND m.profile_hash NOT LIKE ?)
       )`,
  )
  let deleted = 0
  for (const { candidate_id } of candidates) {
    let key: string
    // Someone with no profile yet has no current key: nothing of theirs goes.
    try {
      key = currentMatchKey(candidate_id)
    } catch {
      continue
    }
    inTransaction(() => {
      deleted += Number(remove.run(candidate_id, key, before, `%:${ASSESS_VERSION}`).changes)
    })
  }
  return { deleted }
}
