import fs from 'node:fs'
import path from 'node:path'
import { checkPassAlerts, checkWhatsAppStatus } from './admin/alerts'
import { backupToday } from './db/backup'
import { DATA_DIRECTORY, getDb } from './db/db'
import { pruneEarlierMatches } from './matching/prune'
import { rereadsInFlight, runListening, stopping, stopStartingReads, type CandidatePass } from './matching/run'
import { sweepUploads } from './pipeline/sources'
import { checkOfferLinks } from './sourcing/liveness'
import { releaseLock, takeLock } from './sourcing/lock'
import { sendDueFollowups } from './whatsapp/followups'
import { sendDueOffers } from './whatsapp/offers'
import { sendDueRuleQuestions } from './whatsapp/rule-asks'
import { sendDueWantedNudges } from './whatsapp/nudges'
import { sendWeeklySummaries } from './whatsapp/weekly'
import { refreshSummaries } from './telegram/summary'
import { sendDueInterviewQuestions } from './whatsapp/interview'
import { sendDueReminders } from './whatsapp/reminders'
import { sendPauseCheckIns } from './whatsapp/pause'

// Scheduled listening inside the server, for hosting where there is no task
// scheduler: the same four passes a day as the Windows task (08, 12, 16 and
// 20 h, Spain), each under the shared lock and logged to the same place.

const HOURS = [8, 12, 16, 20]
// The WhatsApp questions about sent applications: once a day, mid-morning.
const FOLLOWUP_HOUR = 11
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
  // A full volume refuses the file: the host's logs below still have it.
  try {
    const directory = path.join(DATA_DIRECTORY, 'logs')
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(path.join(directory, `listen-${day}.log`), `${line}\n`)
  } catch {
    // Only there, then.
  }
  // Also to the host's own logs, where the volume's files cannot be read.
  console.log(`[listen] ${line}`)
}

// A re-read after someone changed their rules holds the lock for minutes: the
// pass waits for it rather than being lost until the next slot.
const REREAD_WAIT_MS = 30_000
const REREAD_WAIT_TRIES = 60

async function lockForPass(): Promise<boolean> {
  for (let tries = 0; ; tries++) {
    if (takeLock()) return true
    if (rereadsInFlight() === 0 || tries >= REREAD_WAIT_TRIES) return false
    await new Promise((resolve) => setTimeout(resolve, REREAD_WAIT_MS))
  }
}

// What the schedule has done, on disk: a restart (a deploy) must neither
// lose a pass half done nor run the day's round twice.
const STATE_PATH = path.join(DATA_DIRECTORY, 'schedule-state.json')

interface ScheduleState {
  passes: Record<string, { startedAt: string; finishedAt?: string }>
  roundDay?: string
}

function readState(): ScheduleState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as ScheduleState
  } catch {
    return { passes: {} }
  }
}

function writeState(change: (state: ScheduleState) => void): void {
  const state = readState()
  change(state)
  // Only the last few days are worth keeping.
  const keys = Object.keys(state.passes).sort()
  for (const key of keys.slice(0, Math.max(0, keys.length - 12))) delete state.passes[key]
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1))
}

// A pass still worth resuming this long after its slot began; past it, the
// next one is close.
const RESUME_WITHIN_MINUTES = 210

// Each pass in numbers, for the admin's health tab: roles read (judged or set
// aside on their facts), left for lack of time, and what failed, per person
// and in all. The log keeps the rest.
function recordPass(slot: string, startedAt: string, outcome: 'done' | 'stopped' | 'failed', matching: CandidatePass[], error: string | null) {
  const people = matching.map((entry) =>
    'stats' in entry
      ? {
          candidateId: entry.candidateId,
          read: entry.stats.assessedNow + entry.stats.preGated,
          outOfTime: entry.stats.outOfTime,
          waiting: entry.stats.waiting,
          errors: entry.stats.errors.length,
          firstError: entry.stats.errors[0]?.message ?? null,
        }
      : { candidateId: entry.candidateId, read: 0, outOfTime: 0, waiting: 0, errors: 1, firstError: entry.error },
  )
  const sum = (key: 'read' | 'outOfTime' | 'errors') => people.reduce((total, person) => total + person[key], 0)
  getDb()
    .prepare('INSERT INTO listening_passes (slot, started_at, finished_at, outcome, read, out_of_time, errors, candidates, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(slot, startedAt, new Date().toISOString(), outcome, sum('read'), sum('outOfTime'), sum('errors') + (error ? 1 : 0), JSON.stringify(people), error?.slice(0, 1000) ?? null)
  return { read: sum('read'), outOfTime: sum('outOfTime') }
}

let running = false

// Slots already told another pass holds the lock: said once, tried each minute.
const busyTold = new Set<string>()

async function pass(day: string, slot: string, until: number) {
  running = true
  const locked = await lockForPass()
  running = false
  if (!locked) {
    if (!busyTold.has(slot)) log(day, `==== ${new Date().toISOString()} another pass is running; ${slot} waits for it`)
    busyTold.add(slot)
    return
  }
  running = true
  let done = true
  const startedAt = new Date().toISOString()
  let matching: CandidatePass[] = []
  let failure: string | null = null
  // Why the day's copy was not made, when it was due.
  let backupProblem: string | null = null
  try {
    const resumed = Boolean(readState().passes[slot])
    writeState((state) => {
      state.passes[slot] = { startedAt: state.passes[slot]?.startedAt ?? new Date().toISOString() }
    })
    log(day, `==== ${new Date().toISOString()}${resumed ? ` (resuming ${slot}, cut short by a restart)` : ''}`)
    // The first pass of the day copies the database before writing to it. A
    // copy that cannot be made is said, and the pass goes on without it:
    // people's offers matter more than one day's copy.
    let firstToday = true
    try {
      const copy = await backupToday()
      firstToday = copy.status !== 'exists'
      if (firstToday) log(day, `backup: ${JSON.stringify(copy)}`)
      if (copy.status === 'skipped') backupProblem = copy.reason
      // Made, but not up in R2: kept here (a week of them), and said.
      if (copy.status === 'done' && copy.offsite && 'error' in copy.offsite) backupProblem = `copia hecha aquí, pero no subida a R2: ${copy.offsite.error}`
    } catch (error) {
      backupProblem = error instanceof Error ? error.message : String(error)
      log(day, `backup failed: ${backupProblem}`)
    }
    // And, once a day too, drops what was set aside of what people uploaded.
    if (firstToday) log(day, `uploads: ${JSON.stringify(sweepUploads())}`)
    const result = await runListening({ until })
    matching = result.matching
    log(day, JSON.stringify(result, null, 2))
    // Judgments of earlier profiles nothing reads any more (matching/prune.ts).
    try {
      log(day, `pruned matches: ${JSON.stringify(pruneEarlierMatches())}`)
    } catch (error) {
      log(day, `pruning matches failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Offers from aggregators someone is about to see: their links, opened.
    if (!stopping()) {
      try {
        log(day, `links: ${JSON.stringify(await checkOfferLinks({ until }))}`)
      } catch (error) {
        log(day, `links failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Stopped by a restart: the pass after it picks up where this one was.
    if (stopping()) {
      done = false
      log(day, 'stopped for a restart; to be resumed')
      return
    }
    // What this pass found that deserves a message, at the pace allowed.
    log(day, `offers: ${JSON.stringify(await sendDueOffers())}`)
    // On Telegram, the summary pinned in their chat, as it stands now.
    log(day, `telegram summaries: ${JSON.stringify(await refreshSummaries())}`)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    log(day, `pass failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  } finally {
    running = false
    releaseLock()
    if (done) safely('pass state', () => writeState((state) => void (state.passes[slot] = { ...state.passes[slot], finishedAt: new Date().toISOString() })))
    // A record or an alert that fails is logged; the pass is over either way.
    // The alerts go even when the record cannot be written (a full volume).
    safely('pass record', async () => {
      let totals = { read: 0, outOfTime: 0 }
      try {
        totals = recordPass(slot, startedAt, failure ? 'failed' : done ? 'done' : 'stopped', matching, failure)
      } catch (error) {
        console.error('[listen] pass record failed:', error instanceof Error ? error.message : error)
      }
      // Stopped for a restart: what it left is the next server's, not a lack of time.
      const alerts = await checkPassAlerts({ slot, outOfTime: done ? totals.outOfTime : 0, read: totals.read, failure, backup: backupProblem })
      if (alerts.length > 0) log(day, `alerts: ${alerts.join(', ')}`)
      const whatsapp = await checkWhatsAppStatus()
      if (whatsapp?.changed) log(day, `whatsapp status: ${whatsapp.lastEvent}`)
    })
  }
}

// What the schedule does runs on timers: a failure of its own (the volume
// full, its state unwritable) is logged, never left to end the server.
function safely(what: string, work: () => unknown): void {
  try {
    void Promise.resolve(work()).catch((error) => console.error(`[listen] ${what} failed:`, error instanceof Error ? error.message : error))
  } catch (error) {
    console.error(`[listen] ${what} failed:`, error instanceof Error ? error.message : error)
  }
}

declare global {
  var __ambleSchedule: NodeJS.Timeout | undefined
}

// The slot now due (08, 12, 16 or 20 today), how long since it began, and
// when the next one begins.
function currentSlot(now: Date): { day: string; slot: string; minutesIn: number; until: number } | null {
  const { day, hour, minute } = madrid(now)
  const slotHour = [...HOURS].reverse().find((candidate) => candidate <= hour)
  if (slotHour === undefined) return null
  const nextHour = HOURS.find((candidate) => candidate > slotHour) ?? 24
  return {
    day,
    slot: `${day}T${String(slotHour).padStart(2, '0')}`,
    minutesIn: (hour - slotHour) * 60 + minute,
    until: now.getTime() + ((nextHour - hour) * 60 - minute) * 60_000,
  }
}

export function startListeningSchedule(): void {
  if (globalThis.__ambleSchedule) return
  // The only server: a lock found when it starts was left by the one before it.
  releaseLock()
  // Told to stop (a deploy): no new reads, the lock let go; the next server resumes.
  process.once('SIGTERM', () => {
    stopStartingReads()
    releaseLock()
    console.log('[listen] stopping: no new reads; the next server resumes the pass')
  })
  const tick = () => {
    const now = new Date()
    const { day, hour } = madrid(now)
    const state = readState()
    if (hour === FOLLOWUP_HOUR && state.roundDay !== day) {
      writeState((next) => void (next.roundDay = day))
      // In this order, one after another: an interview question only goes to
      // someone nothing else was sent to that day.
      safely('rounds', async () => {
        const rounds: [string, () => Promise<unknown>][] = [
          ['followups', sendDueFollowups],
          ['reminders', sendDueReminders],
          // Mondays: how their week went, when something moved.
          ['weekly', sendWeeklySummaries],
          // A rule waiting for their yes comes before a question about their map.
          ['rule questions', sendDueRuleQuestions],
          // An offer they liked and have not sent, asked about once.
          ['wanted nudges', sendDueWantedNudges],
          ['interview', sendDueInterviewQuestions],
          ['pause check-ins', sendPauseCheckIns],
        ]
        for (const [name, round] of rounds) {
          await round()
            .then((stats) => log(day, `${name}: ${JSON.stringify(stats)}`))
            .catch((error) => log(day, `${name} failed: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
    }
    // The slot's pass, if it has not finished: at its hour, or resumed after a
    // restart while there is still time for it.
    const due = currentSlot(now)
    if (!due || running || stopping() || due.minutesIn > RESUME_WITHIN_MINUTES) return
    // A slot missed while the server was down is made up too.
    if (state.passes[due.slot]?.finishedAt) return
    safely('pass', () => pass(due.day, due.slot, due.until))
  }
  globalThis.__ambleSchedule = setInterval(() => safely('tick', tick), TICK_MS)
  globalThis.__ambleSchedule.unref?.()
  // Right away too: a pass cut short by the restart resumes now, not in a minute.
  setTimeout(() => safely('tick', tick), 5_000).unref?.()
}
