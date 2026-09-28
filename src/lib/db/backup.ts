import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY, getDb } from './db'

// A copy of the database a day, kept on the same volume, the last few only.
// It guards against a bad write or a broken migration, not against losing the
// volume: for that, the owner downloads a copy (GET /api/admin/backup).

const KEEP = 7
const DIRECTORY = path.join(DATA_DIRECTORY, 'backups')

export function backupToday(): string | null {
  const day = new Date().toISOString().slice(0, 10)
  const target = path.join(DIRECTORY, `amble-${day}.db`)
  if (fs.existsSync(target)) return null
  fs.mkdirSync(DIRECTORY, { recursive: true })
  // VACUUM INTO writes a consistent copy while the database stays in use.
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const copies = fs
    .readdirSync(DIRECTORY)
    .filter((name) => /^amble-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
  for (const old of copies.slice(0, Math.max(0, copies.length - KEEP))) fs.rmSync(path.join(DIRECTORY, old), { force: true })
  return target
}
