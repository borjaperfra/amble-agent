import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY } from '../db/db'

// Listening passes must not overlap, whoever starts them (the scheduler in the
// server, a script, the Windows task): two would judge the same offers twice.
// A lock older than this was left by a pass that died, and is taken over.
export const LOCK_PATH = path.join(DATA_DIRECTORY, 'sourcing.lock')
const LOCK_STALE_MS = 3 * 60 * 60 * 1000

export function takeLock(): boolean {
  try {
    if (fs.existsSync(LOCK_PATH) && Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) fs.rmSync(LOCK_PATH)
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

export function releaseLock(): void {
  fs.rmSync(LOCK_PATH, { force: true })
}
