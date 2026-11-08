// npm test: every check in tests/, each in its own process with a data
// folder of its own (AMBLE_DATA_DIR in a fresh temp folder, removed after),
// so none writes to .amble-data/ and none sees what another wrote. No model
// is called: the checks that ask the model are evals (npm run eval:agent).
// Plain Node, so it runs the same on Windows (Git Bash, PowerShell) and Linux.
//   npm test                  all of them
//   npm test -- check51       only the files whose name has that in it
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const folder = path.join(root, 'tests')
const only = process.argv.slice(2)
const files = fs
  .readdirSync(folder)
  .filter((name) => name.endsWith('.ts'))
  .filter((name) => only.length === 0 || only.some((part) => name.includes(part)))
  .sort()

if (files.length === 0) {
  console.error('No test matches.')
  process.exit(1)
}

// Whatever the shell has, a check never reaches a real model, chat app or inbox.
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^(AMBLE_MODEL_|AMBLE_EVAL_|ZERNIO_|TELEGRAM_|RESEND_|BROWSERBASE_|THEIRSTACK_)/.test(key)) delete env[key]
}

const failed = []
for (const name of files) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-test-'))
  const started = Date.now()
  const run = spawnSync(process.execPath, ['--import', 'tsx', path.join('tests', name)], {
    cwd: root,
    env: { ...env, AMBLE_DATA_DIR: dataDir },
    encoding: 'utf8',
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  try {
    fs.rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // A file still held open on Windows: the temp folder is cleaned by the system.
  }
  if (run.status === 0) {
    console.log(`ok    ${name} (${seconds}s)`)
  } else {
    failed.push(name)
    console.log(`FAIL  ${name} (${seconds}s)`)
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`.trim()
    console.log(output.split('\n').slice(-30).map((line) => `      ${line}`).join('\n'))
  }
}

console.log(`\n${files.length - failed.length} of ${files.length} passed${failed.length ? `; failed: ${failed.join(', ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
