/**
 * A tiny serial job queue.
 *
 * The interview used to make the candidate wait for everything: extracting
 * claims from their answer, reassessing capabilities, then planning the next
 * question. That was ~45s of staring at a spinner between questions, with
 * peaks near two minutes.
 *
 * Now the answer is stored, the work is queued, and the next question — which
 * was planned while they were typing — is handed over immediately. The graph
 * catches up in the background.
 *
 * Serial on purpose: these jobs read and write the same rows, and SQLite is a
 * single writer. Concurrency here would buy nothing and cost correctness.
 */

export type JobKind = 'incorporate_answer' | 'plan_question' | 'build_profile'

export interface JobRecord {
  id: string
  kind: JobKind
  candidateId: string
  startedAt: number
  finishedAt: number | null
  error: string | null
}

interface QueueState {
  pending: { id: string; kind: JobKind; candidateId: string; run: () => Promise<void> }[]
  running: JobRecord | null
  history: JobRecord[]
  draining: boolean
}

declare global {
  var __ambleJobs: QueueState | undefined
}

function state(): QueueState {
  if (!globalThis.__ambleJobs) {
    globalThis.__ambleJobs = { pending: [], running: null, history: [], draining: false }
  }
  return globalThis.__ambleJobs
}

let counter = 0

export function enqueue(kind: JobKind, candidateId: string, run: () => Promise<void>): string {
  const queue = state()
  const id = `job_${Date.now().toString(36)}_${(counter++).toString(36)}`
  queue.pending.push({ id, kind, candidateId, run })
  void drain()
  return id
}

async function drain(): Promise<void> {
  const queue = state()
  if (queue.draining) return
  queue.draining = true

  try {
    while (queue.pending.length > 0) {
      const job = queue.pending.shift()!
      const record: JobRecord = {
        id: job.id,
        kind: job.kind,
        candidateId: job.candidateId,
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
      }
      queue.running = record
      try {
        await job.run()
      } catch (error) {
        record.error = error instanceof Error ? error.message : 'Background job failed.'
      }
      record.finishedAt = Date.now()
      queue.running = null
      queue.history.push(record)
      if (queue.history.length > 50) queue.history.shift()
    }
  } finally {
    queue.draining = false
  }
}

export interface QueueStatus {
  busy: boolean
  pending: number
  running: JobKind | null
  /** Errors from jobs that finished since the last time they were read. */
  recentErrors: string[]
}

export function queueStatus(candidateId: string): QueueStatus {
  const queue = state()
  const mine = queue.pending.filter((job) => job.candidateId === candidateId)
  const running = queue.running?.candidateId === candidateId ? queue.running.kind : null
  return {
    busy: running !== null || mine.length > 0,
    pending: mine.length,
    running,
    recentErrors: queue.history
      .filter((record) => record.candidateId === candidateId && record.error)
      .slice(-3)
      .map((record) => record.error as string),
  }
}

export function hasPendingKind(candidateId: string, kind: JobKind): boolean {
  const queue = state()
  if (queue.running?.candidateId === candidateId && queue.running.kind === kind) return true
  return queue.pending.some((job) => job.candidateId === candidateId && job.kind === kind)
}

/** Wait for this candidate's queue to empty. Used before showing the Map. */
export async function waitForQueue(candidateId: string, timeoutMs = 120_000): Promise<boolean> {
  const startedAt = Date.now()
  while (queueStatus(candidateId).busy) {
    if (Date.now() - startedAt > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return true
}
