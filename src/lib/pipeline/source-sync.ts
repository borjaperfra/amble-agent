/**
 * Offers, arriving, from whichever source.
 *
 * Until recently every opportunity Amble saw was pasted in by hand. This
 * asks a source for what is open, holds each one against what the candidate
 * said, and puts the survivors on the queue.
 *
 * The order is the whole design. Whatever the source states as structured
 * fact — what it pays, how much of it is on site — is checked in code, for
 * nothing, by the same `deterministicHardConstraints` the pipeline uses
 * later. An offer paying half the floor is recorded with the reason and
 * never costs a download, let alone a model call.
 *
 * How much that screen catches depends on the source, and it is honest about
 * the difference. Manfred states pay as numbers, so it drops thirteen of
 * seventeen for free. An ATS board states almost nothing, so the triage
 * there is the feed's own department — which is why `departments` exists and
 * why it is not a filter on the job title.
 */

import { getSourceSyncIntervalMs } from '@/lib/features'
import { deterministicHardConstraints } from '@/domains/opportunity/rules'
import type { HardConstraintCheck } from '@/domains/opportunity/types'
import { departmentMatches } from '../sources/ats'
import { rubricFromFeed, screenedText, type FeedAdapter } from '../sources/types'
import {
  findOpportunityBySourceRef,
  insertOpportunity,
  listAuditEvents,
  recordAuditEvent,
} from '../db/opportunities'
import { readPreferences } from './preferences'
import { enqueue, hasQueuedKind, type JobKind } from './jobs'

export interface SyncOptions {
  /** How many new offers to take this time, screened ones included. */
  limit?: number
  /**
   * How many survivors to actually evaluate. Each is three model calls and
   * about a minute, so the default is a number you can sit through.
   */
  maxEvaluations?: number
  pauseMs?: number
  /** Keep only offers the source itself files under one of these. */
  departments?: string[]
}

export interface SyncResult {
  source: string
  listed: number
  outOfScope: number
  alreadyKnown: number
  screenedOut: number
  read: number
  unreadable: number
  imported: number
  queued: number
  /** Stored and worth reading, but over the evaluation cap for this run. */
  waiting: number
  screenReasons: { company: string; role: string; reason: string }[]
}

export async function syncSource(
  candidateId: string,
  adapter: FeedAdapter,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const limit = options.limit ?? 40
  const maxEvaluations = options.maxEvaluations ?? 10
  const pauseMs = options.pauseMs ?? 400
  const departments = options.departments ?? []

  const preferences = readPreferences(candidateId)
  const constraints = {
    salaryMin: preferences.salaryMin,
    salaryCurrency: preferences.salaryCurrency,
    workMode: preferences.workMode,
    location: preferences.location,
    technologies: preferences.technologies,
    stages: preferences.stages,
  }

  const listed = await adapter.list()
  const result: SyncResult = {
    source: adapter.source,
    listed: listed.length,
    outOfScope: 0,
    alreadyKnown: 0,
    screenedOut: 0,
    read: 0,
    unreadable: 0,
    imported: 0,
    queued: 0,
    waiting: 0,
    screenReasons: [],
  }

  let taken = 0
  for (const offer of listed) {
    if (taken >= limit) break
    if (!offer.active) continue
    if (!departmentMatches(offer, departments)) {
      result.outOfScope += 1
      continue
    }
    if (findOpportunityBySourceRef(candidateId, offer.sourceRef)) {
      result.alreadyKnown += 1
      continue
    }
    taken += 1

    const failed = deterministicHardConstraints(constraints, rubricFromFeed(offer)).filter(
      (check) => check.verdict === 'FAIL',
    )

    // The expensive half only happens for what got through the free one.
    let rawText = screenedText(offer)
    if (failed.length === 0) {
      try {
        rawText = await adapter.rawText(offer)
        result.read += 1
      } catch {
        // One offer that will not load is not a reason to abandon the sync.
        result.unreadable += 1
        continue
      }
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
    }

    const opportunity = insertOpportunity({
      candidate_id: candidateId,
      company: offer.company,
      role: offer.role,
      url: offer.url,
      raw_text: rawText,
      provenance: offer.source,
      source_ref: offer.sourceRef,
      status: failed.length > 0 ? 'screened_out' : 'received',
      status_detail: failed.length > 0 ? reasonFor(failed) : null,
    })
    result.imported += 1

    recordAuditEvent({
      candidate_id: candidateId,
      subject_type: 'opportunity',
      subject_id: opportunity.id,
      event: failed.length > 0 ? 'opportunity_screened_out' : 'opportunity_received',
      detail: {
        company: offer.company,
        role: offer.role,
        source: offer.source,
        sourceRef: offer.sourceRef,
        chars: rawText.length,
        // Which check said no, and on what. Auditable without re-reading it.
        failed: failed.map((check) => ({ id: check.id, basis: check.basis })),
      },
    })

    if (failed.length > 0) {
      result.screenedOut += 1
      result.screenReasons.push({
        company: offer.company,
        role: offer.role,
        reason: reasonFor(failed),
      })
    } else if (result.queued < maxEvaluations) {
      enqueue('evaluate_opportunity', candidateId, { opportunityId: opportunity.id })
      result.queued += 1
    } else {
      result.waiting += 1
    }
  }

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'source',
    subject_id: adapter.source,
    event: 'source_synced',
    detail: { ...result, screenReasons: result.screenReasons.length },
  })

  return result
}

/**
 * Every adapter in a group, and one record that the group ran.
 *
 * The group record is what the scheduler reads. Without it a group of boards
 * leaves behind rows named after each board, the scheduler finds nothing
 * under its own name, concludes it has never run, and queues another one
 * immediately — a loop that reads two boards forever and looks, from the
 * outside, like the app is simply busy.
 */
export async function syncAll(
  candidateId: string,
  adapters: FeedAdapter[],
  options: SyncOptions = {},
  group = 'all',
): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  for (const adapter of adapters) {
    try {
      results.push(await syncSource(candidateId, adapter, options))
    } catch {
      // A board that is down, renamed or gone is not a reason to skip the
      // others. It will be there again on the next pass, or it will not.
      results.push({
        source: adapter.source,
        listed: 0,
        outOfScope: 0,
        alreadyKnown: 0,
        screenedOut: 0,
        read: 0,
        unreadable: 0,
        imported: 0,
        queued: 0,
        waiting: 0,
        screenReasons: [],
      })
    }
  }

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'source',
    subject_id: group,
    event: 'source_group_synced',
    detail: {
      sources: results.map((result) => result.source),
      imported: results.reduce((total, result) => total + result.imported, 0),
      queued: results.reduce((total, result) => total + result.queued, 0),
    },
  })

  return results
}

// ─── Keeping it listening ─────────────────────────────────────────────────

/** Which source a recurring job is for, and how long ago it last ran. */
const SUBJECT: Record<string, string> = {
  sync_manfred: 'manfred',
  sync_ats: 'ats',
}

/**
 * Make sure there is a next one on the queue, and only one.
 *
 * Called after every sync and from the endpoints the screens poll, so the
 * schedule survives a restart, a crash mid-sync, and a laptop that was shut
 * for three days — the first request after it comes back finds nothing
 * queued and nothing synced recently, and goes immediately.
 */
export function ensureSyncScheduled(candidateId: string, kind: JobKind): void {
  const intervalMs = getSourceSyncIntervalMs()
  if (intervalMs === null) return
  if (hasQueuedKind(candidateId, kind)) return

  // The group record, not a single board's: see `syncAll`.
  const history = listAuditEvents('source', SUBJECT[kind] ?? kind).filter(
    (event) => event.event === 'source_group_synced',
  )
  const last = history[history.length - 1]
  const since = last ? Date.now() - new Date(last.created_at).getTime() : Number.POSITIVE_INFINITY
  enqueue(kind, candidateId, {}, since >= intervalMs ? 0 : intervalMs - since)
}

function reasonFor(failed: HardConstraintCheck[]): string {
  return failed.map((check) => `${check.constraint}. ${check.basis}`).join(' ')
}
