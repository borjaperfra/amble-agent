/**
 * A serial job queue that lives on disk.
 *
 * The interview used to make the candidate wait for everything: extracting
 * claims from their answer, reassessing capabilities, then planning the next
 * question. That was ~45s of staring at a spinner between questions, with
 * peaks near two minutes. Now the answer is stored, the work is queued, and
 * the next question — planned while they were typing — is handed over
 * immediately.
 *
 * The queue is in SQLite rather than in memory because Amble is used from a
 * phone. A tunnel takes the connection away for minutes, and a job held in a
 * closure inside a process dies with the request that started it. On disk it
 * can be retried on a schedule, survives a restart, and can be picked up by
 * something that is not a web request at all — which is where this is going.
 *
 * Serial on purpose: these jobs read and write the same rows, and SQLite is a
 * single writer. Concurrency here would buy nothing and cost correctness.
 */

import {
  claimNextJob,
  failJob,
  finishJob,
  insertJob,
  listActiveJobs,
  listFailedJobs,
  newId,
  nextJobDueAt,
  requeueStrandedJobs,
  retryJob,
  type JobRow,
} from '../db/repo'

export type JobKind = 'incorporate_answer' | 'plan_question' | 'build_profile'

export interface JobPayloads {
  incorporate_answer: { turnId: string }
  plan_question: Record<string, never>
  build_profile: Record<string, never>
}

/**
 * How long to wait before each further attempt. A dropped connection comes
 * back in seconds; a tunnel takes minutes. After the last one the job is
 * marked failed and stops costing anything.
 */
const BACKOFF_MS = [5_000, 20_000, 60_000, 180_000, 600_000]
const MAX_ATTEMPTS = BACKOFF_MS.length + 1

declare global {
  var __ambleQueue: { draining: boolean; timer: NodeJS.Timeout | null; recovered: boolean } | undefined
}

function runtime() {
  if (!globalThis.__ambleQueue) {
    globalThis.__ambleQueue = { draining: false, timer: null, recovered: false }
  }
  const state = globalThis.__ambleQueue
  if (!state.recovered) {
    state.recovered = true
    requeueStrandedJobs()
  }
  return state
}

/**
 * The work itself, looked up by kind. Imported lazily: the pipeline modules
 * enqueue jobs, so importing them at the top would close the circle.
 */
async function run(job: JobRow): Promise<void> {
  const payload = JSON.parse(job.payload || '{}') as Record<string, unknown>

  switch (job.kind as JobKind) {
    case 'incorporate_answer': {
      const { incorporateAnswerJob } = await import('./interview')
      await incorporateAnswerJob(job.candidate_id, String(payload.turnId ?? ''))
      return
    }
    case 'plan_question': {
      const { planQuestionJob } = await import('./interview')
      await planQuestionJob(job.candidate_id)
      return
    }
    case 'build_profile': {
      const { buildDistinctiveProfile, buildDescriptor } = await import('./graph')
      await buildDistinctiveProfile(job.candidate_id)
      await buildDescriptor(job.candidate_id)
      return
    }
    default:
      throw new Error(`Unknown job kind: ${job.kind}`)
  }
}

export function enqueue<K extends JobKind>(
  kind: K,
  candidateId: string,
  payload: JobPayloads[K] = {} as JobPayloads[K],
): string {
  const id = newId('job')
  insertJob({
    id,
    candidate_id: candidateId,
    kind,
    payload: JSON.stringify(payload),
  })
  void drain()
  return id
}

async function drain(): Promise<void> {
  const state = runtime()
  if (state.draining) return
  state.draining = true

  try {
    for (;;) {
      const job = claimNextJob()
      if (!job) break

      try {
        await run(job)
        finishJob(job.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Background job failed.'
        const backoff = BACKOFF_MS[job.attempts - 1]
        if (job.attempts >= MAX_ATTEMPTS || backoff === undefined) {
          failJob(job.id, message)
        } else {
          retryJob(job.id, new Date(Date.now() + backoff), message)
        }
      }
    }
  } finally {
    state.draining = false
    scheduleNextWake()
  }
}

/** Jobs waiting on a backoff need someone to come back for them. */
function scheduleNextWake(): void {
  const state = runtime()
  const due = nextJobDueAt()
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (!due) return

  const delay = Math.max(250, new Date(due).getTime() - Date.now())
  state.timer = setTimeout(() => {
    state.timer = null
    void drain()
  }, delay)
  // Never hold the process open for a retry that can just as well happen on
  // the next request.
  state.timer.unref?.()
}

export interface QueueStatus {
  busy: boolean
  pending: number
  running: JobKind | null
  /** Waiting out a backoff after something failed: worth saying out loud. */
  retrying: boolean
  /** When the next attempt is due, if one is waiting. */
  nextAttemptAt: string | null
  /** Errors from jobs that ran out of attempts. */
  recentErrors: string[]
}

export function queueStatus(candidateId: string): QueueStatus {
  const active = listActiveJobs(candidateId)
  const running = active.find((job) => job.status === 'running')
  const waiting = active.filter((job) => job.status === 'pending')
  const backingOff = waiting.filter((job) => job.attempts > 0)

  return {
    busy: active.length > 0,
    pending: waiting.length,
    running: (running?.kind as JobKind) ?? null,
    retrying: backingOff.length > 0,
    nextAttemptAt: backingOff[0]?.run_after ?? null,
    recentErrors: listFailedJobs(candidateId).map(
      (job) => job.last_error ?? 'Background work failed.',
    ),
  }
}

export function hasPendingKind(candidateId: string, kind: JobKind): boolean {
  return listActiveJobs(candidateId).some((job) => job.kind === kind)
}

/**
 * Wait for this candidate's queue to empty. Used before showing the Map.
 * Returns false if it is still busy when the time runs out — a job backing
 * off for ten minutes is not worth holding a page for.
 */
export async function waitForQueue(candidateId: string, timeoutMs = 120_000): Promise<boolean> {
  const startedAt = Date.now()
  void drain()
  while (queueStatus(candidateId).busy) {
    if (Date.now() - startedAt > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return true
}

/** Pick up anything left over, whatever brought this process up. */
export function resumeQueue(): void {
  void drain()
}
