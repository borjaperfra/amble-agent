/**
 * The first thing that arrives on its own.
 *
 * Until now every opportunity Amble saw was pasted in by hand. This asks
 * Manfred's public API for every live offer, holds each one against what the
 * candidate said, and puts the survivors on the queue.
 *
 * The order matters, and it is the whole design. One request returns every
 * active offer with what it pays, how much of it is on site and where. All
 * of that is checkable in code, for nothing, by the same
 * `deterministicHardConstraints` the pipeline uses later — so an offer that
 * pays half the floor is recorded with the reason and never costs a
 * download, let alone a model call. Only what survives is fetched in full.
 *
 * Polite by construction: one detail request at a time with a pause, an
 * offer already stored is never fetched again, and the User-Agent says who
 * this is.
 */

import { getManfredSyncIntervalMs } from '@/lib/features'
import { deterministicHardConstraints } from '@/domains/opportunity/rules'
import type { HardConstraintCheck } from '@/domains/opportunity/types'
import {
  fetchOffer,
  fetchOfferSummaries,
  rubricFromFeed,
  summaryText,
} from '../sources/manfred'
import {
  findOpportunityBySourceRef,
  insertOpportunity,
  listAuditEvents,
  recordAuditEvent,
} from '../db/opportunities'
import { readPreferences } from './preferences'
import { enqueue, hasQueuedKind } from './jobs'

export interface ManfredSyncOptions {
  /** How many new offers to take this time, screened ones included. */
  limit?: number
  /**
   * How many survivors to actually evaluate. Each is three model calls and
   * about a minute, so the default is a number you can sit through.
   */
  maxEvaluations?: number
  pauseMs?: number
  language?: string
}

export interface ManfredSyncResult {
  liveOffers: number
  alreadyKnown: number
  /** Dropped on the list alone, before anything was downloaded. */
  screenedOut: number
  read: number
  unreadable: number
  imported: number
  queued: number
  /** Stored and worth reading, but over the evaluation cap for this run. */
  waiting: number
  screenReasons: { company: string; role: string; reason: string }[]
}

export async function syncManfredOffers(
  candidateId: string,
  options: ManfredSyncOptions = {},
): Promise<ManfredSyncResult> {
  const limit = options.limit ?? 40
  const maxEvaluations = options.maxEvaluations ?? 10
  const pauseMs = options.pauseMs ?? 400
  const language = options.language ?? 'ES'

  const preferences = readPreferences(candidateId)
  const constraints = {
    salaryMin: preferences.salaryMin,
    salaryCurrency: preferences.salaryCurrency,
    workMode: preferences.workMode,
    location: preferences.location,
    technologies: preferences.technologies,
    stages: preferences.stages,
  }

  const summaries = await fetchOfferSummaries(language)
  const result: ManfredSyncResult = {
    liveOffers: summaries.length,
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
  for (const summary of summaries) {
    if (taken >= limit) break
    if (!summary.active) continue
    if (findOpportunityBySourceRef(candidateId, summary.sourceRef)) {
      result.alreadyKnown += 1
      continue
    }
    taken += 1

    const failed = deterministicHardConstraints(constraints, rubricFromFeed(summary)).filter(
      (check) => check.verdict === 'FAIL',
    )

    // The expensive half only happens for what got through the free one.
    let rawText = summaryText(summary)
    if (failed.length === 0) {
      try {
        rawText = (await fetchOffer(summary, language)).rawText
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
      company: summary.company,
      role: summary.position,
      url: summary.url,
      raw_text: rawText,
      provenance: 'manfred',
      source_ref: summary.sourceRef,
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
        company: summary.company,
        role: summary.position,
        source: 'manfred',
        sourceRef: summary.sourceRef,
        chars: rawText.length,
        // Which check said no, and on what. Auditable without re-reading it.
        failed: failed.map((check) => ({ id: check.id, basis: check.basis })),
      },
    })

    if (failed.length > 0) {
      result.screenedOut += 1
      result.screenReasons.push({
        company: summary.company,
        role: summary.position,
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
    subject_id: 'manfred',
    event: 'source_synced',
    detail: {
      live: result.liveOffers,
      alreadyKnown: result.alreadyKnown,
      screenedOut: result.screenedOut,
      imported: result.imported,
      queued: result.queued,
      waiting: result.waiting,
      unreadable: result.unreadable,
    },
  })

  return result
}

// ─── Keeping it listening ─────────────────────────────────────────────────

/**
 * Make sure there is a next one on the queue, and only one.
 *
 * Called after every sync and from the endpoints the screens poll, so the
 * schedule survives a restart, a crash mid-sync, and a laptop that was shut
 * for three days — the first request after it comes back finds nothing
 * queued and nothing synced recently, and goes immediately.
 */
export function ensureManfredSyncScheduled(candidateId: string): void {
  const intervalMs = getManfredSyncIntervalMs()
  if (intervalMs === null) return
  if (hasQueuedKind(candidateId, 'sync_manfred')) return

  const history = listAuditEvents('source', 'manfred')
  const last = history[history.length - 1]
  const since = last ? Date.now() - new Date(last.created_at).getTime() : Number.POSITIVE_INFINITY
  enqueue('sync_manfred', candidateId, {}, since >= intervalMs ? 0 : intervalMs - since)
}

function reasonFor(failed: HardConstraintCheck[]): string {
  return failed.map((check) => `${check.constraint}. ${check.basis}`).join(' ')
}
