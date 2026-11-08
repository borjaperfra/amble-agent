import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { DATA_DIRECTORY, getDb } from './db'
import { offsiteConfig, uploadOffsite } from './offsite'

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
//
// With R2 set (offsite.ts), each daily copy also goes there, and once it is
// up only today's stays on the volume: the week of copies lives off it.

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
  // offsite: up to R2, or why not (the copies then stay here, a week of them).
  | {
      status: 'done'
      file: string
      bytes: number
      removed: string[]
      offsite?: { key: string } | { error: string }
      // The files people gave (CVs, PDFs, applications), up to R2 beside it.
      files?: { key: string; bytes: number } | { error: string }
    }
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
  const offsite = await sendOffsite(target)
  if (offsite && 'key' in offsite) removed.push(...keepOnlyToday(target))
  const files = offsite && 'key' in offsite ? await sendFilesOffsite(day) : null
  return { status: 'done', file: target, bytes: size(target), removed, ...(offsite ? { offsite } : {}), ...(files ? { files } : {}) }
}

// What people gave amble lives only on the volume: their CVs and PDFs
// (uploads), what went with their applications (applications) and other
// files (files). The database's copy holds none of it, so a lost volume
// would lose every CV. Each day, beside the database's copy and under the
// same name scheme, so the bucket's rule deletes it on the same day: what a
// deleted account leaves goes from R2 within the week, as amble promises.
// Packed off the volume (os.tmpdir) and never kept on it.
const FILE_DIRECTORIES = ['uploads', 'applications', 'files']

export async function sendFilesOffsite(day: string): Promise<{ key: string; bytes: number } | { error: string } | null> {
  const config = offsiteConfig()
  if (!config) return null
  const present = FILE_DIRECTORIES.filter((name) => fs.existsSync(path.join(DATA_DIRECTORY, name)))
  if (present.length === 0) return null
  const archive = path.join(os.tmpdir(), `amble-files-${day}.tar.gz`)
  try {
    execFileSync('tar', ['-czf', archive, '-C', DATA_DIRECTORY, ...present], { stdio: 'ignore' })
    const key = `daily/${path.basename(archive)}`
    await uploadOffsite(config, archive, key)
    return { key, bytes: size(archive) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    fs.rmSync(archive, { force: true })
  }
}

// The day's copy to R2, when it is set.
export async function sendOffsite(file: string): Promise<{ key: string } | { error: string } | null> {
  const config = offsiteConfig()
  if (!config) return null
  const key = `daily/${path.basename(file)}`
  try {
    await uploadOffsite(config, file, key)
    return { key }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

// Up in R2: the older dailies leave the volume.
function keepOnlyToday(today: string): string[] {
  const removed: string[] = []
  for (const name of fs.readdirSync(BACKUP_DIRECTORY)) {
    if (DAILY.test(name) && path.join(BACKUP_DIRECTORY, name) !== today) {
      fs.rmSync(path.join(BACKUP_DIRECTORY, name), { force: true })
      removed.push(name)
    }
  }
  return removed
}

// The latest daily copy on the volume, for sending it by hand (admin).
export function latestDaily(): string | null {
  if (!fs.existsSync(BACKUP_DIRECTORY)) return null
  const last = fs
    .readdirSync(BACKUP_DIRECTORY)
    .filter((name) => name.endsWith('.db.gz') && DAILY.test(name))
    .sort()
    .pop()
  return last ? path.join(BACKUP_DIRECTORY, last) : null
}
