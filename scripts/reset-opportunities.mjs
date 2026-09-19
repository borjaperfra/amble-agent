/**
 * Take the opportunities out of the local database and leave the graph alone.
 *
 *   npm run reset:opportunities          # only the ones loaded from fixtures
 *   npm run reset:opportunities -- --all # hand-entered ones too
 *
 * Deleting `.amble-data/` resets everything, which is usually what you want —
 * except here. The Professional Graph behind it costs a CV, an interview and
 * twenty minutes of somebody's evening; the ten fixtures cost eleven minutes
 * of a machine's. Measuring calibration twice means clearing the second
 * without touching the first, because a fixture already read is skipped as
 * `alreadyPresent` and would quietly turn a rerun into a no-op.
 *
 * The model runs go too. They are what the harness averages, and leaving the
 * old ones in makes the latency table a mix of two different rule sets.
 */

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const all = process.argv.includes('--all')
const dbPath = path.join(process.cwd(), '.amble-data', 'amble.db')

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Nothing to clear.`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = ON;')

const where = all ? '1 = 1' : "provenance = 'fixture'"
const targets = db.prepare(`SELECT id, company, role, provenance FROM opportunities WHERE ${where}`).all()

if (targets.length === 0) {
  console.log(all ? 'No opportunities stored.' : 'No fixture opportunities stored.')
  db.close()
  process.exit(0)
}

const ids = targets.map((row) => row.id)
const holes = ids.map(() => '?').join(', ')
const run = (sql) => db.prepare(sql).run(...ids).changes

// Children first: the rows point back up, and the pragma is on.
const counts = {
  responses: run(`DELETE FROM opportunity_responses WHERE opportunity_id IN (${holes})`),
  decisions: run(`DELETE FROM opportunity_decisions WHERE opportunity_id IN (${holes})`),
  assessments: run(`DELETE FROM opportunity_assessments WHERE opportunity_id IN (${holes})`),
  rubrics: run(`DELETE FROM opportunity_rubrics WHERE opportunity_id IN (${holes})`),
  labels: run(`DELETE FROM opportunity_labels WHERE opportunity_id IN (${holes})`),
  audit: run(
    `DELETE FROM audit_events WHERE subject_type = 'opportunity' AND subject_id IN (${holes})`,
  ),
  opportunities: run(`DELETE FROM opportunities WHERE id IN (${holes})`),
}

// Anything still queued would come back looking for rows that are gone.
counts.jobs = db
  .prepare("DELETE FROM jobs WHERE kind = 'evaluate_opportunity'")
  .run().changes

if (db.prepare('SELECT COUNT(*) AS n FROM opportunities').get().n === 0) {
  counts.modelRuns = db
    .prepare("DELETE FROM model_runs WHERE task LIKE 'opportunity_%'")
    .run().changes
}

db.close()

for (const row of targets) {
  console.log(`  removed  ${row.provenance.padEnd(8)} ${row.company} — ${row.role}`)
}
console.log()
for (const [what, n] of Object.entries(counts)) {
  if (n > 0) console.log(`${String(n).padStart(5)}  ${what}`)
}
console.log()
console.log('The graph, the intent profile and the preferences were not touched.')
