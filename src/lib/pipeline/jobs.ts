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
 * Two lanes, each serial. Planning the next question takes about five
 * seconds; working an answer into the graph takes forty. One lane meant the
 * candidate waited for both, because a queue only consults its order between
 * jobs and never interrupts the one running. So the thing somebody is
 * actually staring at gets a lane of its own.
 *
 * Within a lane it stays serial: these jobs read and write the same rows and
 * SQLite takes one writer. Across lanes the planner may read a graph that is
 * a minute out of date, which it already did when it ran first, and it is
 * given the recent questions and answers directly either way.
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

export type JobKind =
  | 'process_source'
  | 'assess_capabilities'
  | 'incorporate_answer'
  | 'plan_question'
  | 'build_profile'
  | 'evaluate_opportunity'
  | 'deliver_notification'
  | 'sync_manfred'
  | 'sync_ats'

export interface JobPayloads {
  process_source: { sourceId: string }
  assess_capabilities: Record<string, never>
  incorporate_answer: { turnId: string }
  plan_question: Record<string, never>
  build_profile: Record<string, never>
  evaluate_opportunity: { opportunityId: string }
  deliver_notification: { notificationId: string }
  sync_manfred: { limit?: number; maxEvaluations?: number }
  sync_ats: { limit?: number; maxEvaluations?: number }
}

/**
 * How long to wait before each further attempt. A dropped connection comes
 * back in seconds; a tunnel takes minutes. After the last one the job is
 * marked failed and stops costing anything.
 */
const BACKOFF_MS = [5_000, 20_000, 60_000, 180_000, 600_000]
const MAX_ATTEMPTS = BACKOFF_MS.length + 1

/** The candidate is watching this one. Everything else can take its time. */
const LANES = {
  interactive: ['plan_question'],
  background: [
    'process_source',
    'assess_capabilities',
    'incorporate_answer',
    'build_profile',
    'evaluate_opportunity',
    'deliver_notification',
    'sync_manfred',
    'sync_ats',
  ],
} as const satisfies Record<string, readonly JobKind[]>

type Lane = keyof typeof LANES

function laneOf(kind: JobKind): Lane {
  return (LANES.interactive as readonly JobKind[]).includes(kind) ? 'interactive' : 'background'
}

interface LaneState {
  draining: boolean
  timer: NodeJS.Timeout | null
}

declare global {
  var __ambleQueue: { lanes: Record<Lane, LaneState>; recovered: boolean } | undefined
}

function runtime() {
  if (!globalThis.__ambleQueue) {
    globalThis.__ambleQueue = {
      lanes: {
        interactive: { draining: false, timer: null },
        background: { draining: false, timer: null },
      },
      recovered: false,
    }
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
    case 'process_source': {
      const { getSource } = await import('../db/repo')
      const { processSource } = await import('./sources')
      const source = getSource(String(payload.sourceId ?? ''))
      if (!source) throw new Error(`Source ${payload.sourceId} is gone.`)
      if (source.status === 'processed') return
      await processSource(source, job.candidate_id)
      return
    }
    case 'assess_capabilities': {
      // The queue takes the oldest job that is *due*, so a source backing off
      // after a failure would otherwise let this one overtake it and assess a
      // candidate whose CV has not been read yet. Stand aside and come back.
      if (hasPendingKind(job.candidate_id, 'process_source')) {
        enqueue('assess_capabilities', job.candidate_id, {}, 5_000)
        return
      }
      const { groundAndAssess } = await import('./graph')
      await groundAndAssess(job.candidate_id)
      return
    }
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
    case 'evaluate_opportunity': {
      const { evaluateOpportunity } = await import('./opportunities')
      const { getOpportunity } = await import('../db/opportunities')
      const id = String(payload.opportunityId ?? '')
      const opportunity = getOpportunity(id)
      if (!opportunity) throw new Error(`Opportunity ${id} is gone.`)
      // Already answered. A retry that arrives late must not pay for a
      // second reading, or leave a second decision behind it.
      if (opportunity.status === 'decided') return
      await evaluateOpportunity(id)
      return
    }
    case 'deliver_notification': {
      const { deliverNotificationJob } = await import('./notify')
      await deliverNotificationJob(String(payload.notificationId ?? ''))
      return
    }
    case 'sync_manfred':
    case 'sync_ats': {
      const kind = job.kind as JobKind
      const { syncAll, ensureSyncScheduled } = await import('./source-sync')
      const { manfredAdapter } = await import('../sources/manfred')
      const { configuredAtsAdapters, configuredDepartments } = await import('../sources/ats')
      const options = {
        limit: typeof payload.limit === 'number' ? payload.limit : undefined,
        maxEvaluations:
          typeof payload.maxEvaluations === 'number' ? payload.maxEvaluations : undefined,
        departments: kind === 'sync_ats' ? configuredDepartments() : [],
      }
      try {
        await syncAll(
          job.candidate_id,
          kind === 'sync_ats' ? configuredAtsAdapters() : [manfredAdapter()],
          options,
          kind === 'sync_ats' ? 'ats' : 'manfred',
        )
      } finally {
        // Before anything else can go wrong: a sync that fails and does not
        // put the next one on the queue stops listening for good, quietly,
        // which is the one failure this product cannot have.
        ensureSyncScheduled(job.candidate_id, kind)
      }
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
  delayMs = 0,
): string {
  const id = newId('job')
  insertJob({
    id,
    candidate_id: candidateId,
    kind,
    payload: JSON.stringify(payload),
    runAfter: delayMs > 0 ? new Date(Date.now() + delayMs) : undefined,
  })
  void drain(laneOf(kind))
  return id
}

async function drain(lane: Lane): Promise<void> {
  const state = runtime().lanes[lane]
  if (state.draining) return
  state.draining = true

  try {
    for (;;) {
      const job = claimNextJob([...LANES[lane]])
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
    scheduleNextWake(lane)
  }
}

/** Jobs waiting on a backoff need someone to come back for them. */
function scheduleNextWake(lane: Lane): void {
  const state = runtime().lanes[lane]
  const due = nextJobDueAt([...LANES[lane]])
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (!due) return

  const delay = Math.max(250, new Date(due).getTime() - Date.now())
  state.timer = setTimeout(() => {
    state.timer = null
    void drain(lane)
  }, delay)
  // Never hold the process open for a retry that can just as well happen on
  // the next request.
  state.timer.unref?.()
}

export interface QueueStatus {
  busy: boolean
  pending: number
  running: JobKind | null
  /** Every kind in flight, running or waiting. */
  kinds: JobKind[]
  /** Waiting out a backoff after something failed: worth saying out loud. */
  retrying: boolean
  /** When the next attempt is due, if one is waiting. */
  nextAttemptAt: string | null
  /** Errors from jobs that ran out of attempts. */
  recentErrors: string[]
}

/** A minute out is still "any moment now". Five hours out is not. */
const SOON_MS = 60_000

export function queueStatus(candidateId: string): QueueStatus {
  const active = listActiveJobs(candidateId)
  const running = active.find((job) => job.status === 'running')
  const waiting = active.filter((job) => job.status === 'pending')
  const backingOff = waiting.filter((job) => job.attempts > 0)

  // A recurring sync sits on the queue for hours between runs. Counting it
  // as work in progress would leave every screen polling every two seconds
  // all afternoon, waiting for something that is not happening yet.
  const soon = active.filter(
    (job) =>
      job.status === 'running' || new Date(job.run_after).getTime() - Date.now() < SOON_MS,
  )

  return {
    busy: soon.length > 0,
    pending: soon.filter((job) => job.status === 'pending').length,
    running: (running?.kind as JobKind) ?? null,
    kinds: [...new Set(soon.map((job) => job.kind as JobKind))],
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
 * Waiting, as opposed to waiting or running. A job that wants to put its own
 * successor on the queue has to ask this one: it is itself still running,
 * and would otherwise always find a reason not to.
 */
export function hasQueuedKind(candidateId: string, kind: JobKind): boolean {
  return listActiveJobs(candidateId).some(
    (job) => job.kind === kind && job.status === 'pending',
  )
}

/**
 * Wait for this candidate's queue to empty. Used before showing the Map.
 * Returns false if it is still busy when the time runs out — a job backing
 * off for ten minutes is not worth holding a page for.
 */
export async function waitForQueue(candidateId: string, timeoutMs = 120_000): Promise<boolean> {
  const startedAt = Date.now()
  resumeQueue()
  while (queueStatus(candidateId).busy) {
    if (Date.now() - startedAt > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return true
}

/** Pick up anything left over, whatever brought this process up. */
export function resumeQueue(): void {
  void drain('interactive')
  void drain('background')
}
