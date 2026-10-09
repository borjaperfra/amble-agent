import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { DATA_DIRECTORY, getDb } from './db'

// A copy of the database a day, kept on the same volume, the last few only.
// It guards against a bad write or a broken migration, not against losing the
// volume: for that, the owner downloads a copy (GET /api/admin/backup).
//
// The volume is small and the database grows: on 2026-10-09 the copies filled
// it and every pass failed. So a copy is made outside the volume and only its
// compressed form lands on it; nothing stays longer than a week (what amble
// promises about a deleted account), copies taken by hand included; and when
// there is no room for one, it is skipped and said, never left to stop a pass.
// To restore one: gunzip it, then put it in place of amble.db.

const KEEP = 7
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// What a copy must leave free on the volume: room for the database to keep
// growing (and its write-ahead log) until the next one.
const RESERVE_BYTES = 512 * 1024 * 1024
export const BACKUP_DIRECTORY = path.join(DATA_DIRECTORY, 'backups')
const DAILY = /^amble-\d{4}-\d{2}-\d{2}\.db(\.gz)?$/

export interface VolumeUsage {
  total: number
  available: number
  database: number
  backups: number
  copies: number
}

export type BackupResult =
  | { status: 'exists' }
  | { status: 'done'; file: string; bytes: number; removed: string[] }
  | { status: 'skipped'; reason: string; removed: string[] }

const size = (file: string) => {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

const databaseBytes = () => ['', '-wal'].reduce((sum, suffix) => sum + size(path.join(DATA_DIRECTORY, `amble.db${suffix}`)), 0)

export function volumeUsage(): VolumeUsage | null {
  try {
    const stats = fs.statfsSync(DATA_DIRECTORY)
    const files = fs.existsSync(BACKUP_DIRECTORY) ? fs.readdirSync(BACKUP_DIRECTORY) : []
    return {
      total: stats.blocks * stats.bsize,
      available: stats.bavail * stats.bsize,
      database: databaseBytes(),
      backups: files.reduce((sum, name) => sum + size(path.join(BACKUP_DIRECTORY, name)), 0),
      copies: files.length,
    }
  } catch {
    return null
  }
}

// What goes before a copy is made: a copy cut short, anything a week old (a
// copy by hand before a risky write, a replica left behind), and the oldest
// dailies, so that with today's there are KEEP.
function prune(): string[] {
  if (!fs.existsSync(BACKUP_DIRECTORY)) return []
  const removed: string[] = []
  const remove = (name: string) => {
    fs.rmSync(path.join(BACKUP_DIRECTORY, name), { force: true, recursive: true })
    removed.push(name)
  }
  const names = fs.readdirSync(BACKUP_DIRECTORY)
  for (const name of names) {
    if (name.includes('.partial')) remove(name)
    else if (Date.now() - fs.statSync(path.join(BACKUP_DIRECTORY, name)).mtimeMs > MAX_AGE_MS) remove(name)
  }
  const dailies = fs
    .readdirSync(BACKUP_DIRECTORY)
    .filter((name) => DAILY.test(name))
    .sort()
  for (const old of dailies.slice(0, Math.max(0, dailies.length - (KEEP - 1)))) remove(old)
  return removed
}

export async function backupToday(): Promise<BackupResult> {
  const day = new Date().toISOString().slice(0, 10)
  const target = path.join(BACKUP_DIRECTORY, `amble-${day}.db.gz`)
  if (fs.existsSync(target) || fs.existsSync(path.join(BACKUP_DIRECTORY, `amble-${day}.db`))) return { status: 'exists' }
  fs.mkdirSync(BACKUP_DIRECTORY, { recursive: true })
  const removed = prune()
  // The last copy says how much the next one takes; without one, half the database.
  const last = fs
    .readdirSync(BACKUP_DIRECTORY)
    .filter((name) => name.endsWith('.db.gz') && DAILY.test(name))
    .sort()
    .pop()
  const expected = Math.ceil((last ? size(path.join(BACKUP_DIRECTORY, last)) * 1.2 : databaseBytes() * 0.5))
  const usage = volumeUsage()
  if (usage && usage.available - expected < RESERVE_BYTES) {
    const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`
    return { status: 'skipped', reason: `${mb(usage.available)} free, a copy takes about ${mb(expected)} and ${mb(RESERVE_BYTES)} must stay free`, removed }
  }
  // VACUUM INTO writes a consistent copy while the database stays in use, off
  // the volume; compressed onto it under another name first: a copy cut short
  // (a full volume, a restart) must never stand as the day's backup.
  const snapshot = path.join(os.tmpdir(), `amble-backup-${Date.now()}.db`)
  const partial = `${target}.partial`
  try {
    getDb().prepare('VACUUM INTO ?').run(snapshot)
    await pipeline(fs.createReadStream(snapshot), createGzip({ level: 6 }), fs.createWriteStream(partial))
    fs.renameSync(partial, target)
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw error
  } finally {
    fs.rmSync(snapshot, { force: true })
  }
  return { status: 'done', file: target, bytes: size(target), removed }
}
