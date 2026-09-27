// Sourcing from the command line: which companies the Rep watches, and reading
// their offers. Meant to be scheduled (cron, Windows Task Scheduler).
//
//   npm run sourcing -- watch "Company" [careers-url]   find its board and watch it
//   npm run sourcing -- directory [--refresh]           watch every company in the directory
//   npm run sourcing -- run                             read every watched board, then apply retention
//   npm run sourcing -- prune                           apply retention only (src/lib/db/retention.ts)
//   npm run sourcing -- status                          companies and offer counts
//   npm run sourcing -- match [limit]                   judge offers not yet judged (model calls)
//   npm run sourcing -- listen [limit]                  run, then match: one listening pass
//   npm run sourcing -- matches                         what the Rep would show you, and why

import { countOpportunities, listCompanies } from '../src/lib/db/opportunities'
import { getOrCreateCandidate } from '../src/lib/db/repo'
import { applyRetention } from '../src/lib/db/retention'
import { runSourcing, syncDirectory, watchCompany } from '../src/lib/sourcing/run'
import { listMatchesForKey } from '../src/lib/db/matching'
import { currentMatchKey, runListening, runMatching } from '../src/lib/matching/run'
import type { Explanation } from '../src/lib/matching/assess'
import { DATA_DIRECTORY } from '../src/lib/db/db'
import fs from 'node:fs'
import path from 'node:path'

// Scheduled passes must not overlap: two would judge the same offers twice. A
// lock older than this is left by a pass that died, and is taken over.
const LOCK_PATH = path.join(DATA_DIRECTORY, 'sourcing.lock')
const LOCK_STALE_MS = 3 * 60 * 60 * 1000

function takeLock(): boolean {
  try {
    if (fs.existsSync(LOCK_PATH) && Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) fs.rmSync(LOCK_PATH)
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
    process.on('exit', () => fs.rmSync(LOCK_PATH, { force: true }))
    return true
  } catch {
    return false
  }
}

const WRITES = new Set(['run', 'match', 'listen', 'directory', 'prune'])

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (WRITES.has(command) && !takeLock()) {
    console.log(`Another sourcing pass is running (${LOCK_PATH}); nothing done.`)
    return
  }

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

  if (command === 'directory') {
    const stats = await syncDirectory({ refresh: args.includes('--refresh') })
    console.log(`${stats.watching}/${stats.entries} directory companies watched (${stats.resolvedNow.length} resolved now).`)
    if (stats.unresolved.length) console.log(`No public board found: ${stats.unresolved.join(', ')}`)
    for (const error of stats.errors) console.log(`  ! ${error.company}: ${error.message}`)
    return
  }

  if (command === 'prune') {
    console.log(JSON.stringify(applyRetention(), null, 2))
    console.log(countOpportunities())
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
    const candidateId = getOrCreateCandidate().id
    for (const match of listMatchesForKey(candidateId, currentMatchKey(candidateId)).filter((m) => m.verdict === 'show')) {
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

  throw new Error('Commands: watch "Company" [careers-url] | directory [--refresh] | run | prune | status | match [limit] | listen [limit] | matches')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
