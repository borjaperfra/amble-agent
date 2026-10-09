import { volumeUsage, type VolumeUsage } from '../db/backup'
import { getDb } from '../db/db'
import { currentMatchKey } from '../matching/run'
import { whatsappAccountStatus, zernioConfig, ZernioError, type WhatsAppAccountStatus } from '../whatsapp/zernio'

// How amble is doing, for the owner's health tab: the scheduled passes, the
// model, each person's reading, WhatsApp and the forms filled. All of it from
// indexes or small tables (the database is large): nothing here reads an
// offer's text, a model's output or a message's body.

const DAY_MS = 24 * 60 * 60 * 1000

export interface PassRow {
  slot: string
  started_at: string
  finished_at: string
  outcome: 'done' | 'stopped' | 'failed'
  read: number
  out_of_time: number
  errors: number
  error: string | null
  // The first thing that failed, for the pass and per person.
  first_error: string | null
}

export interface ModelDay {
  day: string
  calls: number
  failed: number
  limited: number
  prompt_tokens: number
  cached_tokens: number
  completion_tokens: number
}

export interface ModelPerson {
  candidate_id: string | null
  who: string | null
  calls: number
  failed: number
  limited: number
  prompt_tokens: number
  cached_tokens: number
  completion_tokens: number
}

export interface PersonReading {
  candidate_id: string
  who: string
  paused: boolean
  // Left for a later pass at their last read (null: never read).
  waiting: number | null
  last_read_at: string | null
  shown: number
  hold: number
  discarded: number
  released: number
  // In the last pass that read them.
  out_of_time: number | null
}

export interface WhatsAppDay {
  day: string
  inbound: number
  outbound: number
  reviewed: number
  offers_sent: number
  offers_failed: number
}

export interface ApplicationRunRow {
  who: string
  title: string | null
  company: string | null
  kind: 'fill' | 'submit'
  via: 'app' | 'whatsapp'
  outcome: string
  detail: string | null
  started_at: string
  ended_at: string
}

export interface AlertRow {
  kind: string
  sent_at: string | null
}

export interface AdminHealth {
  at: string
  passes: PassRow[]
  modelDays: ModelDay[]
  modelPeople: ModelPerson[]
  people: PersonReading[]
  whatsappDays: WhatsAppDay[]
  applications: ApplicationRunRow[]
  alerts: AlertRow[]
  // The data volume: full, every pass fails (2026-10-09). Null where it cannot be read.
  volume: VolumeUsage | null
}

const since = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()

function passes(): PassRow[] {
  const rows = getDb()
    .prepare('SELECT slot, started_at, finished_at, outcome, read, out_of_time, errors, candidates, error FROM listening_passes ORDER BY started_at DESC LIMIT 20')
    .all() as unknown as (Omit<PassRow, 'first_error'> & { candidates: string })[]
  return rows.map(({ candidates, ...row }) => {
    const people = JSON.parse(candidates) as { firstError?: string | null }[]
    return { ...row, first_error: row.error ?? people.find((person) => person.firstError)?.firstError ?? null }
  })
}

// Days are UTC days (the stored times are UTC). A 429 counts only when the
// call gave up on it: those retried and then answered leave no trace here.
function modelDays(): ModelDay[] {
  return getDb()
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(error LIKE '%HTTP 429%'), 0) AS limited,
         COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(cached_tokens), 0) AS cached_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM model_runs WHERE created_at >= ? GROUP BY day ORDER BY day DESC`,
    )
    .all(since(14)) as unknown as ModelDay[]
}

// Calls without a person are shared work (an offer's facts, the feedback triage).
// Left to itself the planner walks the per-person index, which reads each
// row's output; the usage index holds all it needs.
function modelPeople(): ModelPerson[] {
  return getDb()
    .prepare(
      `SELECT r.candidate_id, COALESCE(c.email, c.name) AS who, r.calls, r.failed, r.limited, r.prompt_tokens, r.cached_tokens, r.completion_tokens
       FROM (SELECT candidate_id, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(error LIKE '%HTTP 429%'), 0) AS limited,
               COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(cached_tokens), 0) AS cached_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens
             FROM model_runs INDEXED BY model_runs_usage WHERE created_at >= ? GROUP BY candidate_id) r
       LEFT JOIN candidates c ON c.id = r.candidate_id
       ORDER BY r.calls DESC`,
    )
    .all(since(7)) as unknown as ModelPerson[]
}

// What is left to read is the count their last read kept (matching_stats):
// counting it afresh means running the prefilter over every open offer for
// each of them, which is what a pass does. It lags until their next read.
function people(): PersonReading[] {
  const db = getDb()
  const candidates = db
    .prepare('SELECT id, COALESCE(email, name, id) AS who, search_paused_at FROM candidates ORDER BY created_at ASC')
    .all() as unknown as { id: string; who: string; search_paused_at: string | null }[]
  const stats = new Map(
    (db.prepare('SELECT candidate_id, at, stats FROM matching_stats').all() as unknown as { candidate_id: string; at: string; stats: string }[]).map((row) => [
      row.candidate_id,
      { at: row.at, waiting: (JSON.parse(row.stats) as { waiting?: number }).waiting ?? null },
    ]),
  )
  const released = new Map(
    (db.prepare('SELECT candidate_id, COUNT(*) AS n FROM offer_releases GROUP BY candidate_id').all() as unknown as { candidate_id: string; n: number }[]).map((row) => [
      row.candidate_id,
      row.n,
    ]),
  )
  // The last pass that read each of them.
  const lastPass = new Map<string, number>()
  const recent = db.prepare('SELECT candidates FROM listening_passes ORDER BY started_at DESC LIMIT 8').all() as unknown as { candidates: string }[]
  for (const row of recent) {
    for (const person of JSON.parse(row.candidates) as { candidateId: string; outOfTime: number }[]) {
      if (!lastPass.has(person.candidateId)) lastPass.set(person.candidateId, person.outOfTime)
    }
  }
  const verdicts = db.prepare('SELECT verdict, COUNT(*) AS n FROM opportunity_matches WHERE candidate_id = ? AND profile_hash = ? GROUP BY verdict')
  return candidates.map((candidate) => {
    const counts: Record<string, number> = {}
    // Someone who has shared nothing yet has no profile to key their offers to.
    try {
      for (const row of verdicts.all(candidate.id, currentMatchKey(candidate.id)) as unknown as { verdict: string; n: number }[]) counts[row.verdict] = row.n
    } catch {
      // No counts, then.
    }
    const read = stats.get(candidate.id)
    return {
      candidate_id: candidate.id,
      who: candidate.who,
      paused: candidate.search_paused_at !== null,
      waiting: read?.waiting ?? null,
      last_read_at: read?.at ?? null,
      shown: counts.show ?? 0,
      hold: counts.hold ?? 0,
      discarded: counts.discarded ?? 0,
      released: released.get(candidate.id) ?? 0,
      out_of_time: lastPass.get(candidate.id) ?? null,
    }
  })
}

// An offer the second reading said to send that has no time sent did not go
// (the provider refused it, or the window closed on it).
function whatsappDays(): WhatsAppDay[] {
  const db = getDb()
  const from = since(14)
  const days = new Map<string, WhatsAppDay>()
  const day = (key: string) => {
    let entry = days.get(key)
    if (!entry) days.set(key, (entry = { day: key, inbound: 0, outbound: 0, reviewed: 0, offers_sent: 0, offers_failed: 0 }))
    return entry
  }
  const messages = db
    .prepare('SELECT substr(created_at, 1, 10) AS day, direction, COUNT(*) AS n FROM whatsapp_messages WHERE created_at >= ? GROUP BY day, direction')
    .all(from) as unknown as { day: string; direction: string; n: number }[]
  for (const row of messages) day(row.day)[row.direction === 'in' ? 'inbound' : 'outbound'] += row.n
  // A few rows a person a day: read whole.
  const reviews = db
    .prepare(
      `SELECT substr(reviewed_at, 1, 10) AS day, COUNT(*) AS reviewed, SUM(decision = 'send' AND sent_at IS NULL) AS failed
       FROM offer_sends WHERE reviewed_at >= ? GROUP BY day`,
    )
    .all(from) as unknown as { day: string; reviewed: number; failed: number }[]
  for (const row of reviews) Object.assign(day(row.day), { reviewed: row.reviewed, offers_failed: row.failed })
  const sent = db.prepare('SELECT substr(sent_at, 1, 10) AS day, COUNT(*) AS n FROM offer_sends WHERE sent_at >= ? GROUP BY day').all(from) as unknown as { day: string; n: number }[]
  for (const row of sent) day(row.day).offers_sent = row.n
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day))
}

function applications(): ApplicationRunRow[] {
  return getDb()
    .prepare(
      `SELECT COALESCE(c.email, c.name, r.candidate_id) AS who, o.title, co.name AS company, r.kind, r.via, r.outcome, r.detail, r.started_at, r.ended_at
       FROM application_runs r
       LEFT JOIN candidates c ON c.id = r.candidate_id
       LEFT JOIN opportunities o ON o.id = r.opportunity_id
       LEFT JOIN companies co ON co.id = o.company_id
       ORDER BY r.started_at DESC LIMIT 30`,
    )
    .all() as unknown as ApplicationRunRow[]
}

export function loadHealth(): AdminHealth {
  return {
    at: new Date().toISOString(),
    passes: passes(),
    modelDays: modelDays(),
    modelPeople: modelPeople(),
    people: people(),
    whatsappDays: whatsappDays(),
    applications: applications(),
    volume: volumeUsage(),
    alerts: getDb().prepare('SELECT kind, sent_at FROM health_alerts WHERE sent_at IS NOT NULL ORDER BY sent_at DESC').all() as unknown as AlertRow[],
  }
}

export type WhatsAppAccountState =
  | { connection: 'off' }
  | { connection: 'error'; status: number | null }
  | ({ connection: 'ok'; sandbox: boolean } & WhatsAppAccountStatus)

// Asked of Zernio each time the tab opens, from the server: the key never
// leaves it, and neither does anything the provider said beyond these fields.
export async function loadWhatsAppAccount(): Promise<WhatsAppAccountState> {
  const config = zernioConfig()
  if (!config) return { connection: 'off' }
  try {
    return { connection: 'ok', sandbox: config.sandbox, ...(await whatsappAccountStatus(config)) }
  } catch (error) {
    console.error('[amble] whatsapp account not read:', error instanceof Error ? error.message : error)
    return { connection: 'error', status: error instanceof ZernioError ? error.status : null }
  }
}
