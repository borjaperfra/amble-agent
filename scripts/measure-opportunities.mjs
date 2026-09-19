/**
 * The Opportunity Zero test set, run end to end and held against the labels
 * that were written before anything ran.
 *
 *   npm run measure:opportunities
 *
 * What this measures is calibration, not accuracy on a benchmark. Ten
 * fixtures, none of them obviously wrong, each a different way of being
 * nearly right. The two numbers that matter are the two errors:
 *
 *   NO  x INTERRUPT — noise. Someone was bothered for nothing.
 *   YES x IGNORE    — a miss. The one thing they wanted went past silently.
 *
 * Everything else is observation. There is no score, deliberately: a single
 * number would become the thing you say instead of looking at the ten cases.
 *
 * It drives the real HTTP routes against a running dev server, so what is
 * measured is what the product does — queue, retries and all.
 */

import fs from 'node:fs'
import path from 'node:path'
import { gapFixtures, opportunityFixtures } from '../src/fixtures/opportunities.ts'

const BASE = process.env.AMBLE_MEASURE_BASE ?? 'http://localhost:3000'
const TIMEOUT_MS = Number.parseInt(process.env.AMBLE_MEASURE_TIMEOUT_MS ?? '', 10) || 1_800_000
const args = process.argv.slice(2)
const only = args.filter((arg) => !arg.startsWith('-'))

/**
 * Two sets, measured apart.
 *
 * The calibration set asks whether Amble can tell a near-miss from a match,
 * and its numbers are the two errors. The gap set is all matches, and its
 * number is whether a hold asks the one right question. Averaging them
 * together would hide both.
 */
const set = args.includes('--gaps')
  ? 'gaps'
  : args.includes('--all')
    ? 'all'
    : 'calibration'

const s = (ms) => `${(ms / 1000).toFixed(1)}s`
const now = () => Date.now()
const pad = (value, width) => String(value).padEnd(width)

async function api(pathname, init) {
  const response = await fetch(`${BASE}${pathname}`, init)
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    /* an HTML error page, most likely */
  }
  if (!response.ok) {
    throw new Error(`${pathname} -> HTTP ${response.status}: ${body?.error ?? text.slice(0, 200)}`)
  }
  return body
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/opportunities`)
      if (response.ok) return
      if (response.status === 404) {
        throw new Error('The server is up but User Zero mode is off. Set AMBLE_USER_ZERO=true.')
      }
    } catch (error) {
      if (error.message.includes('User Zero')) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`No dev server answering at ${BASE}. Run npm run dev first.`)
}

// -- Set up ------------------------------------------------------------
await waitForServer()

const pool =
  set === 'gaps' ? gapFixtures : set === 'all' ? [...opportunityFixtures, ...gapFixtures] : opportunityFixtures

const fixtures = only.length
  ? pool.filter((fixture) => only.some((key) => fixture.key.includes(key)))
  : pool

if (fixtures.length === 0) {
  console.error(`No fixture matches ${only.join(', ')}.`)
  process.exit(1)
}

let vm = await api('/api/opportunities')
if (!vm.graphReady) {
  console.error('There is no Professional Graph to hold anything against.')
  console.error('Run the User Zero journey first: a CV at /onboarding, then a few questions.')
  console.error('Matching reads assessed evidence, not documents.')
  process.exit(1)
}

console.log(`server        ${BASE}`)
console.log(
  `against       ${vm.capabilitiesCount} capabilities, ${vm.evidenceCount} pieces of evidence`,
)
console.log(`set           ${set}`)
console.log(`fixtures      ${fixtures.length}`)
console.log()

// -- Send them all in --------------------------------------------------
const submitted = []
for (const fixture of fixtures) {
  const result = await api('/api/opportunities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: fixture.company,
      role: fixture.role,
      url: fixture.url,
      rawText: fixture.rawText,
      fixtureKey: fixture.key,
      // Written with the fixture, before anything ran. Stored in its own
      // table; nothing that builds a prompt reads that table.
      label: fixture.blindLabel,
      labelComment: fixture.blindComment,
    }),
  })
  submitted.push({ fixture, id: result.id, alreadyPresent: result.alreadyPresent })
  console.log(`${pad(fixture.key, 26)} ${result.alreadyPresent ? 'read once already' : 'queued'}`)
}

// -- Watch the queue ---------------------------------------------------
console.log()
const startedAt = now()
const wanted = new Set(submitted.map((item) => item.id))
const seen = new Set()

for (;;) {
  vm = await api('/api/opportunities')
  for (const item of vm.opportunities) {
    if (!wanted.has(item.id) || seen.has(item.id) || !item.decision) continue
    seen.add(item.id)
    const { fixture } = submitted.find((entry) => entry.id === item.id)
    console.log(
      `${s(now() - startedAt).padStart(7)}  ${pad(fixture.key, 26)} ${item.decision.decision}`,
    )
  }
  if (seen.size === wanted.size) break

  const failures = vm.queue.recentErrors ?? []
  if (failures.length > 0) {
    console.log(`  the queue gave up on something: ${failures[0]}`)
    break
  }
  if (now() - startedAt > TIMEOUT_MS) {
    console.log(
      `  still ${wanted.size - seen.size} unread after ${s(now() - startedAt)}; reporting anyway`,
    )
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 2000))
}

// -- Report ------------------------------------------------------------
const byId = new Map(vm.opportunities.map((item) => [item.id, item]))
const rows = submitted.map(({ fixture, id }) => {
  const item = byId.get(id)
  const decision = item?.decision ?? null
  return {
    key: fixture.key,
    shape: fixture.shape,
    blindLabel: fixture.blindLabel,
    blindComment: fixture.blindComment,
    decision: decision?.decision ?? null,
    modelDecision: decision?.modelDecision ?? null,
    overrideReason: decision?.overrideReason ?? null,
    hardFails: (item?.analysis?.hardConstraints ?? []).filter((check) => check.verdict === 'FAIL'),
    materialUnknowns: decision?.materialUnknowns ?? [],
    nextBestAction: decision?.nextBestAction ?? null,
    unsupportedClaims: decision?.unsupportedClaims ?? [],
    status: item?.status ?? 'unread',
  }
})

console.log()
console.log('-- Case by case -------------------------------------------------------')
for (const row of rows) {
  console.log()
  console.log(`${row.key}  (${row.shape})`)
  console.log(`  wanted         ${row.blindLabel} — ${row.blindComment}`)
  console.log(`  amble said     ${row.decision ?? `nothing yet (${row.status})`}`)
  if (row.modelDecision && row.modelDecision !== row.decision) {
    console.log(`  the model said ${row.modelDecision}, and the rules moved it`)
    console.log(`                 ${row.overrideReason}`)
  }
  for (const fail of row.hardFails) {
    console.log(`  hard fail      ${fail.constraint} — ${fail.basis}`)
  }
  if (row.decision === 'HOLD' && row.nextBestAction) {
    console.log(
      `  to resolve     ${row.nextBestAction.type}${row.nextBestAction.question ? `: ${row.nextBestAction.question}` : ' (nothing usable)'}`,
    )
  }
  for (const claim of row.unsupportedClaims) {
    console.log(`  !! unsupported (${claim.where}) "${claim.text}" — ${claim.why}`)
  }
}

const decided = rows.filter((row) => row.decision !== null)
const count = (label, decision) =>
  decided.filter((row) => row.blindLabel === label && row.decision === decision).length

console.log()
console.log('-- Human label x Amble decision ---------------------------------------')
console.log('          INTERRUPT      HOLD    IGNORE')
for (const label of ['YES', 'MAYBE', 'NO']) {
  console.log(
    `${pad(label, 8)}  ${String(count(label, 'INTERRUPT')).padStart(9)} ${String(count(label, 'HOLD')).padStart(9)} ${String(count(label, 'IGNORE')).padStart(9)}`,
  )
}

const noise = decided.filter((row) => row.blindLabel === 'NO' && row.decision === 'INTERRUPT')
const misses = decided.filter((row) => row.blindLabel === 'YES' && row.decision === 'IGNORE')
const unsupported = rows.reduce((total, row) => total + row.unsupportedClaims.length, 0)
const overrides = rows.filter((row) => row.overrideReason !== null)
const holdsWithoutQuestion = rows.filter(
  (row) => row.decision === 'HOLD' && !row.nextBestAction?.question,
)

console.log()
console.log(
  `Noise   (NO x INTERRUPT)   ${noise.length}${noise.length ? `  ${noise.map((row) => row.key).join(', ')}` : ''}`,
)
console.log(
  `Misses  (YES x IGNORE)     ${misses.length}${misses.length ? `  ${misses.map((row) => row.key).join(', ')}` : ''}`,
)
const holds = decided.filter((row) => row.decision === 'HOLD')
const asked = holds.filter((row) => Boolean(row.nextBestAction?.question))
console.log(`Rules overrode the model   ${overrides.length} of ${decided.length}`)
console.log(
  `Holds that asked something ${asked.length} of ${holds.length}${
    holds.length ? `  (${[...new Set(asked.map((row) => row.nextBestAction.type))].join(', ')})` : ''
  }`,
)
console.log(`Unsupported claims         ${unsupported}  (target: 0)`)
console.log(`Holds with nothing to ask  ${holdsWithoutQuestion.length}  (target: 0)`)
console.log(`Undecided                  ${rows.length - decided.length}`)

// Only this run's calls. The table is otherwise a mix of every evaluation
// the database has ever held, including whatever the feed brought in
// yesterday, and the averages stop meaning anything.
const startedAtIso = new Date(startedAt).toISOString()
const byTask = new Map()
for (const run of vm.modelRuns.filter((run) => run.createdAt >= startedAtIso)) {
  const entry = byTask.get(run.task) ?? { calls: 0, failures: 0, total: 0, worst: 0 }
  entry.calls += 1
  if (!run.ok) entry.failures += 1
  entry.total += run.latencyMs ?? 0
  entry.worst = Math.max(entry.worst, run.latencyMs ?? 0)
  byTask.set(run.task, entry)
}

console.log()
console.log('task                        calls  fail     avg   worst')
for (const [task, entry] of byTask) {
  console.log(
    `${pad(task, 26)}  ${String(entry.calls).padStart(5)}  ${String(entry.failures).padStart(4)}  ${s(entry.total / entry.calls).padStart(6)}  ${s(entry.worst).padStart(6)}`,
  )
}

const out = path.join(process.cwd(), '.amble-data', 'measure-opportunities.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      elapsedMs: now() - startedAt,
      graph: { capabilities: vm.capabilitiesCount, evidence: vm.evidenceCount },
      rows,
      matrix: vm.matrix,
      modelRuns: vm.modelRuns,
    },
    null,
    2,
  ),
)
console.log()
console.log(`Every reading, in full: ${path.relative(process.cwd(), out)}`)
