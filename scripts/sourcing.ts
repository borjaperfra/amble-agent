// Sourcing from the command line: which companies the Rep watches, and reading
// their offers. Meant to be scheduled (cron, Windows Task Scheduler).
//
//   npm run sourcing -- watch "Company" [careers-url]   find its board and watch it
//   npm run sourcing -- run                             read every watched board
//   npm run sourcing -- status                          companies and offer counts

import { countOpportunities, listCompanies } from '../src/lib/db/opportunities'
import { runSourcing, watchCompany } from '../src/lib/sourcing/run'

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

  if (command === 'status') {
    for (const company of listCompanies()) {
      const board = company.ats ? `${company.ats}/${company.ats_token}` : '—'
      console.log(`${company.status.padEnd(10)} ${company.name.padEnd(24)} ${board.padEnd(32)} ${company.last_error ?? ''}`)
    }
    console.log(countOpportunities())
    return
  }

  throw new Error('Commands: watch "Company" [careers-url] | run | status')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
