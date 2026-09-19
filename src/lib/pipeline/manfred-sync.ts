/**
 * The first thing that arrives on its own.
 *
 * Until now every opportunity Amble has seen was pasted in by hand. This
 * walks Manfred's public sitemap, reads the offers, turns them into the
 * shape the rest of the pipeline already understands, and puts the ones
 * worth reading on the queue.
 *
 * Two things keep it from being reckless. It is polite to the source: one
 * request at a time with a pause between them, and an offer already stored
 * is never fetched again. And it is cheap before it is expensive: what the
 * feed states as numbers — what it pays, how much of it is on site — is
 * checked against what the candidate said in code, for free, before any of
 * it reaches a model. An offer paying half the floor is recorded with the
 * reason and never costs a call.
 *
 * That screen is the same `deterministicHardConstraints` the pipeline uses
 * later. It is not a second opinion, it is the same opinion arriving sooner.
 */

import { deterministicHardConstraints } from '@/domains/opportunity/rules'
import type { HardConstraintCheck } from '@/domains/opportunity/types'
import {
  fetchOffer,
  fetchOfferUrls,
  rubricFromFeed,
  type ManfredOffer,
} from '../sources/manfred'
import {
  findOpportunityBySourceRef,
  insertOpportunity,
  recordAuditEvent,
} from '../db/opportunities'
import { readPreferences } from './preferences'
import { enqueue } from './jobs'

export interface ManfredSyncOptions {
  /** How many offer pages to read this time. The sitemap holds ~1,600. */
  limit?: number
  /**
   * How many survivors to actually evaluate. Each one is three model calls
   * and about a minute, so the default is a number you can sit through.
   */
  maxEvaluations?: number
  pauseMs?: number
}

export interface ManfredSyncResult {
  offersInFeed: number
  read: number
  alreadyKnown: number
  closed: number
  unreadable: number
  screenedOut: number
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

  const preferences = readPreferences(candidateId)
  const constraints = {
    salaryMin: preferences.salaryMin,
    salaryCurrency: preferences.salaryCurrency,
    workMode: preferences.workMode,
    location: preferences.location,
    technologies: preferences.technologies,
    stages: preferences.stages,
  }

  const urls = await fetchOfferUrls()
  const result: ManfredSyncResult = {
    offersInFeed: urls.length,
    read: 0,
    alreadyKnown: 0,
    closed: 0,
    unreadable: 0,
    screenedOut: 0,
    imported: 0,
    queued: 0,
    waiting: 0,
    screenReasons: [],
  }

  for (const url of urls) {
    if (result.read >= limit) break

    // The id is in the path, so a known offer costs nothing at all — not
    // even the request to find out it is known.
    const sourceRef = sourceRefFor(url)
    if (!sourceRef) continue
    if (findOpportunityBySourceRef(candidateId, sourceRef)) {
      result.alreadyKnown += 1
      continue
    }

    result.read += 1
    let offer: ManfredOffer | null = null
    try {
      offer = await fetchOffer(url)
    } catch {
      // One page that will not load is not a reason to abandon the sync.
      result.unreadable += 1
      continue
    }
    if (!offer) {
      result.unreadable += 1
      continue
    }
    if (!offer.active) {
      result.closed += 1
      continue
    }

    const failed = deterministicHardConstraints(constraints, rubricFromFeed(offer)).filter(
      (check) => check.verdict === 'FAIL',
    )

    const opportunity = insertOpportunity({
      candidate_id: candidateId,
      company: offer.company,
      role: offer.title,
      url: offer.url,
      raw_text: offer.rawText,
      provenance: 'manfred',
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
        role: offer.title,
        source: 'manfred',
        sourceRef: offer.sourceRef,
        chars: offer.rawText.length,
        // Which check said no, and on what. Auditable without re-reading it.
        failed: failed.map((check) => ({ id: check.id, basis: check.basis })),
      },
    })

    if (failed.length > 0) {
      result.screenedOut += 1
      result.screenReasons.push({
        company: offer.company,
        role: offer.title,
        reason: reasonFor(failed),
      })
    } else if (result.queued < maxEvaluations) {
      enqueue('evaluate_opportunity', candidateId, { opportunityId: opportunity.id })
      result.queued += 1
    } else {
      result.waiting += 1
    }

    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
  }

  return result
}

function sourceRefFor(url: string): string | null {
  const match = /\/ofertas-empleo\/(\d+)\//.exec(url)
  return match ? `manfred:${match[1]}` : null
}

function reasonFor(failed: HardConstraintCheck[]): string {
  return failed.map((check) => `${check.constraint}. ${check.basis}`).join(' ')
}
