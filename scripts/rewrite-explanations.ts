// Rewrites what people read on their profile (capability names and reasons,
// what is still unknown) in the current voice and in their language. Wording
// only: assessments and evidence stay. /me does the same on its own, in the
// background, the next time each person opens it.
//
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-explanations.ts            who needs it, and how much
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-explanations.ts --run      rewrite everyone who needs it
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-explanations.ts --run <id> just that person (--force: even if current)

import { getDb } from '../src/lib/db/db'
import { hasStaleExplanations, rewriteExplanations } from '../src/lib/career/explanations'

const args = process.argv.slice(2)
const run = args.includes('--run')
const force = args.includes('--force')
const only = args.filter((arg) => !arg.startsWith('--'))

const ids = only.length > 0
  ? only
  : (getDb().prepare('SELECT DISTINCT candidate_id AS id FROM capabilities').all() as { id: string }[]).map((row) => row.id)

async function main() {
  for (const id of ids) {
    const needs = force || hasStaleExplanations(id)
    if (!run) {
      console.log(`${id}: ${needs ? 'needs a rewrite' : 'current'}`)
      continue
    }
    if (!needs) continue
    try {
      const done = await rewriteExplanations(id, { force })
      console.log(`${id}: ${done.capabilities} capabilities, ${done.uncertainties} uncertainties rewritten`)
    } catch (error) {
      console.error(`${id}: failed:`, error instanceof Error ? error.message : error)
    }
  }
}

void main()
