import fs from 'node:fs'
import path from 'node:path'
import { backupToday } from './db/backup'
import { DATA_DIRECTORY } from './db/db'
import { runListening } from './matching/run'
import { releaseLock, takeLock } from './sourcing/lock'

// Scheduled listening inside the server, for hosting where there is no task
// scheduler: the same four passes a day as the Windows task (08, 12, 16 and
// 20 h, Spain), each under the shared lock and logged to the same place.

const HOURS = [8, 12, 16, 20]
const TIME_ZONE = 'Europe/Madrid'
const TICK_MS = 60_000

function madrid(now: Date): { day: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) }
}

function log(day: string, line: string) {
  const directory = path.join(DATA_DIRECTORY, 'logs')
  fs.mkdirSync(directory, { recursive: true })
  fs.appendFileSync(path.join(directory, `listen-${day}.log`), `${line}\n`)
}

async function pass(day: string) {
  if (!takeLock()) {
    log(day, `==== ${new Date().toISOString()} another pass is running; nothing done`)
    return
  }
  log(day, `==== ${new Date().toISOString()}`)
  try {
    // The first pass of the day copies the database before writing to it.
    const copy = backupToday()
    if (copy) log(day, `backup: ${copy}`)
    log(day, JSON.stringify(await runListening(), null, 2))
  } catch (error) {
    log(day, `pass failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    releaseLock()
  }
}

declare global {
  var __ambleSchedule: NodeJS.Timeout | undefined
}

export function startListeningSchedule(): void {
  if (globalThis.__ambleSchedule) return
  let lastSlot: string | null = null
  globalThis.__ambleSchedule = setInterval(() => {
    const { day, hour, minute } = madrid(new Date())
    const slot = `${day}T${hour}`
    // Within the first minutes of a slot, once: a restart at 08:02 still runs it.
    if (!HOURS.includes(hour) || minute > 5 || slot === lastSlot) return
    lastSlot = slot
    void pass(day)
  }, TICK_MS)
  globalThis.__ambleSchedule.unref?.()
}
