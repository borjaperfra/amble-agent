// A copy of production to work against locally, without anyone's way to be
// reached: the server makes a consistent copy, it is downloaded, and before
// anything opens it the people on it are made unreachable.
//
//   npm run db:pull                  into .amble-data/replica/ (then: AMBLE_DATA_DIR=.amble-data/replica)
//   npm run db:pull -- <folder>      somewhere else
//
// Needs the Railway CLI, linked to the project, and the SSH key it uses.
// What is kept: offers, judgments, profiles (what matching needs to be
// reproduced). What goes: sessions, sign-in codes and links, WhatsApp links
// and conversations, invitation addresses; every email but the owner's
// becomes unreachable (example.invalid) and every name but the owner's a
// placeholder. Uploaded files are not copied. It is still personal data
// (careers, answers): delete the folder when done with it.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import zlib from 'node:zlib'

const OWNER = 'user-zero'
// Always production, whatever environment the folder is linked to (`volume` takes the id).
const PRODUCTION_ID = '98fa6fec-864b-45b9-b338-e2b1a5a51187'
const SNAPSHOT = '/data/backups/replica-pull.db'
const PACKED = `${SNAPSHOT}.gz`
const target = path.resolve(process.argv[2] ?? path.join('.amble-data', 'replica'))
const file = path.join(target, 'amble.db')
const packed = `${file}.gz`

// On Windows the CLI installed with npm is a .cmd shim, which cannot run
// without a shell: the binary it wraps is next to it.
function railwayBinary(): string {
  if (process.platform !== 'win32') return 'railway'
  try {
    const shim = execFileSync('where', ['railway.cmd'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
    const binary = path.join(path.dirname(shim), 'node_modules', '@railway', 'cli', 'bin', 'railway.exe')
    return fs.existsSync(binary) ? binary : 'railway'
  } catch {
    return 'railway'
  }
}
const RAILWAY = railwayBinary()

function railway(args: string[]): string {
  // No local shell: the pipe in the ssh command is for the server's, and a
  // path like /backups/… must reach the CLI as written.
  return execFileSync(RAILWAY, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

// A consistent copy on the server, while it keeps running, compressed: the
// download is what takes long, and the CLI gives up on one that is too long.
function snapshot(): void {
  const script = `const {DatabaseSync}=require('node:sqlite');const fs=require('fs');const zlib=require('zlib');for(const f of ['${SNAPSHOT}','${PACKED}'])try{fs.unlinkSync(f)}catch{};const db=new DatabaseSync('/data/amble.db');db.exec('PRAGMA busy_timeout = 15000');db.exec("VACUUM INTO '${SNAPSHOT}'");db.close();require('stream').pipeline(fs.createReadStream('${SNAPSHOT}'),zlib.createGzip({level:6}),fs.createWriteStream('${PACKED}'),(e)=>{fs.unlinkSync('${SNAPSHOT}');if(e)throw e;console.log(fs.statSync('${PACKED}').size)})`
  const encoded = Buffer.from(script).toString('base64')
  const size = railway(['ssh', '--environment', 'production', '--service', 'app', '--', `echo ${encoded} | base64 -d > /tmp/replica.js && node /tmp/replica.js; rm -f /tmp/replica.js`])
  console.log(`snapshot on the server: ${size.trim().split('\n').pop()} bytes compressed`)
}

function download(): void {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      fs.rmSync(packed, { force: true })
      railway(['volume', '--environment', PRODUCTION_ID, 'files', '-v', 'app-volume', 'download', PACKED.replace('/data', ''), packed])
      return
    } catch (error) {
      if (attempt === 2) throw error
      console.log('the download stopped; once more…')
    }
  }
}

function scrub(): void {
  const db = new DatabaseSync(file)
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name))
  const run = (sql: string, ...values: string[]) => {
    const table = /\b(?:FROM|UPDATE|INTO)\s+(\w+)/i.exec(sql)?.[1]
    if (table && !tables.has(table)) return
    db.prepare(sql).run(...values)
  }
  db.exec('BEGIN')
  // Nobody can be signed in as, written to, or sent a code.
  for (const table of ['sessions', 'login_codes', 'app_links', 'whatsapp_link_codes', 'whatsapp_links']) run(`DELETE FROM ${table}`)
  // Their conversations stay theirs; the owner's are kept to reproduce the agent.
  run('DELETE FROM whatsapp_messages WHERE candidate_id != ?', OWNER)
  run('DELETE FROM whatsapp_reminders WHERE candidate_id != ?', OWNER)
  run("UPDATE candidates SET email = id || '@example.invalid' WHERE id != ?", OWNER)
  run("UPDATE candidates SET name = 'Tester ' || substr(id, 6, 4) WHERE id != ? AND name IS NOT NULL", OWNER)
  run("UPDATE waitlist_invites SET email = 'invite-' || rowid || '@example.invalid'")
  db.exec('COMMIT')
  const people = db.prepare('SELECT COUNT(*) AS n FROM candidates').get() as { n: number }
  db.close()
  console.log(`scrubbed: ${people.n} candidates, only ${OWNER} reachable`)
}

fs.mkdirSync(target, { recursive: true })
for (const leftover of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(leftover, { force: true })
try {
  snapshot()
  // Tens of MB even compressed: a few minutes.
  console.log('downloading…')
  download()
} finally {
  // Nothing of it stays on the server, whatever happened.
  railway(['ssh', '--environment', 'production', '--service', 'app', '--', `rm -f ${SNAPSHOT} ${PACKED}`])
}
fs.writeFileSync(file, zlib.gunzipSync(fs.readFileSync(packed)))
fs.rmSync(packed, { force: true })
scrub()
console.log(`ready: ${file}\nuse it with AMBLE_DATA_DIR=${path.relative(process.cwd(), target) || '.'}`)
