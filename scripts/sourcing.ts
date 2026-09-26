// Sourcing from the command line: which companies the Rep watches, and reading
// their offers. Meant to be scheduled (cron, Windows Task Scheduler).
//
//   npm run sourcing -- watch "Company" [careers-url]   find its board and watch it
//   npm run sourcing -- run                             read every watched board
//   npm run sourcing -- status                          companies and offer counts
//   npm run sourcing -- match [limit]                   judge offers not yet judged (model calls)
//   npm run sourcing -- listen [limit]                  run, then match: one listening pass
//   npm run sourcing -- matches                         what the Rep would show you, and why

import { countOpportunities, listCompanies } from '../src/lib/db/opportunities'
import { getOrCreateCandidate } from '../src/lib/db/repo'
import { runSourcing, watchCompany } from '../src/lib/sourcing/run'
import { listMatches } from '../src/lib/db/matching'
import { runListening, runMatching } from '../src/lib/matching/run'
import type { Explanation } from '../src/lib/matching/assess'

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (command === 'watch') {
    const [name, careersUrl] = args
    if (!name) throw new Error('Usage: watch "Company" [careers-url]')
    const { company, board } = await watchCompany({ name, careersUrl: careersUrl ?? null })
    console.log(
      board
        ? `Watching ${company.name}: ${board.ats}/${board.token}, ${board.openCount} open offers (found via ${board.via}).`
        : `No public board found for ${company.name}. Kept as unresolved; aggregators may still cover it.`,
    )
    return
  }

  if (command === 'run') {
    const stats = await runSourcing()
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  if (command === 'match' || command === 'listen') {
    const limit = args[0] ? Number.parseInt(args[0], 10) : undefined
    const result = command === 'match' ? await runMatching({ limit }) : await runListening({ limit })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (command === 'matches') {
    for (const match of listMatches(getOrCreateCandidate().id, 'show')) {
      const explanation = JSON.parse(match.explanation) as Explanation
      console.log(`\n${match.company_name} · ${match.title}${match.closed_at ? ' (closed)' : ''}`)
      console.log(`  ${match.url ?? ''}\n  ${explanation.summary}`)
      for (const reason of explanation.why) console.log(`  + ${reason.text}`)
      if (explanation.considerAlso) console.log(`  ? ${explanation.considerAlso.text}`)
      if (explanation.unknowns.length) console.log(`  … ${explanation.unknowns.join(' · ')}`)
    }
    return
  }

  if (command === 'status') {
    for (const company of listCompanies()) {
      const board = company.ats ? `${company.ats}/${company.ats_token}` : '—'
      console.log(`${company.status.padEnd(10)} ${company.name.padEnd(24)} ${board.padEnd(32)} ${company.last_error ?? ''}`)
    }
    console.log(countOpportunities())
    return
  }

  throw new Error('Commands: watch "Company" [careers-url] | run | status | match [limit] | listen [limit] | matches')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
