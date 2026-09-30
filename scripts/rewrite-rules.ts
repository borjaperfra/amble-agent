// Rules learned from sample offers, written before as the story of how they
// were learned ("Tu suelo real es 75K: dijiste sí a…"), get their plain
// wording ("Salario mínimo: 75.000 €…") and, apart, why amble believes it.
// What the matcher reads (the statement) is not touched, so no assessment is
// read again. A rewrite that loses or adds a figure is refused and the rule
// is left as it was (src/lib/pipeline/rule-wording.ts).
//
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-rules.ts               who has rules to reword, and how many
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-rules.ts --dry <id>    reword that person's, show before/after, write nothing
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-rules.ts --run         reword everyone's
//   npx tsx --env-file-if-exists=.env.local scripts/rewrite-rules.ts --run <id>    just that person

import { candidatesWithRulesToReword, rewordRules, rulesToReword } from '../src/lib/pipeline/rule-wording'

const args = process.argv.slice(2)
const run = args.includes('--run')
const dry = args.includes('--dry')
const only = args.filter((arg) => !arg.startsWith('--'))
const ids = only.length > 0 ? only : candidatesWithRulesToReword()

async function main() {
  let failures = 0
  for (const id of ids) {
    const count = rulesToReword(id).length
    if (!run && !dry) {
      console.log(`${id}: ${count} ${count === 1 ? 'rule' : 'rules'} to reword`)
      continue
    }
    if (count === 0) continue
    try {
      const outcomes = await rewordRules(id, { write: run })
      const done = outcomes.filter((outcome) => !outcome.left).length
      console.log(`\n${id}: ${done} of ${outcomes.length} reworded${run ? '' : ' (dry run: nothing written)'}`)
      for (const outcome of outcomes) {
        console.log(`\n  [${outcome.kind}, ${outcome.status}] ${outcome.id}`)
        console.log(`  before:   ${outcome.before}`)
        console.log(`  wording:  ${outcome.wording ?? '—'}`)
        console.log(`  evidence: ${outcome.evidence ?? '—'}`)
        if (outcome.left) console.log(`  LEFT AS IT WAS: ${outcome.left}`)
      }
    } catch (error) {
      failures++
      console.error(`${id}: failed:`, error instanceof Error ? error.message : error)
    }
  }
  if (failures > 0) process.exitCode = 1
}

void main()
