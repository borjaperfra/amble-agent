import {
  getDistinctiveProfile,
  getLatestIntent,
  getOrCreateCandidate,
  getOrCreateInterview,
  listCapabilities,
  listCapabilityEvidenceIds,
  listClaims,
  listEvidence,
  listEvaluations,
  listModelRuns,
  listSources,
  listTurns,
  listUncertainties,
  parseJsonArray,
  type EvidenceRow,
} from './db/repo'
import type { EvidenceStrength } from '@/domains/candidate/types'
import { getListeningProfile, type ListeningProfile } from './pipeline/listening'

const ASSESSMENT_TO_STRENGTH: Record<string, EvidenceStrength> = {
  STRONG_EVIDENCE: 'strong',
  GOOD_EVIDENCE: 'good',
  SOME_EVIDENCE: 'some',
  LIMITED_EVIDENCE: 'limited',
  NO_EVIDENCE_YET: 'none',
  CONTRADICTORY_EVIDENCE: 'contradictory',
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  cv: 'CV',
  github: 'GitHub',
  linkedin: 'LinkedIn',
  website: 'Website',
  interview: 'Interview',
  verified: 'Verified',
}

export const EPISTEMIC_STATE_LABELS: Record<string, string> = {
  SOURCE_FACT: 'Source fact',
  USER_CLAIM: 'Your claim',
  ASSISTED_CLAIM: 'Co-produced, not yet defended',
  INFERENCE: 'Inference',
  VERIFIED_FACT: 'Verified',
  SYSTEM_ASSESSMENT: 'System assessment',
}

export interface EvidenceViewItem {
  id: string
  claim: string
  sourceType: string
  date: string | null
  confirmed: boolean
  supports: string
  epistemicState: string | null
}

export interface CapabilityViewItem {
  id: string
  name: string
  strength: EvidenceStrength
  explanation: string
  count: number
  evidence: EvidenceViewItem[]
}

export interface GapViewItem {
  id: string
  name: string
  explanation: string
  materiality: string
}

export interface MapViewModel {
  userZero: boolean
  name: string | null
  descriptor: string | null
  updated: string
  capabilities: CapabilityViewItem[]
  gaps: GapViewItem[]
  distinctive: string[] | null
  counts: {
    claims: number
    evidence: number
    capabilities: number
    uncertaintiesOpen: number
    uncertaintiesResolved: number
    sources: number
  }
}

function sourceLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType
}

function evidenceToViewItem(item: EvidenceRow, sourceNames: Map<string, string>): EvidenceViewItem {
  const origin = item.source_id ? sourceNames.get(item.source_id) : null
  const excerpt = item.source_excerpt
  return {
    id: item.id,
    claim: item.statement,
    sourceType: sourceLabel(item.source_type),
    date: item.created_at.slice(0, 10),
    confirmed: item.candidate_confirmed === 1,
    supports: excerpt
      ? origin
        ? `From ${origin}: \u201C${excerpt}\u201D`
        : `\u201C${excerpt}\u201D`
      : origin
        ? `From ${origin}.`
        : 'From your interview.',
    epistemicState: EPISTEMIC_STATE_LABELS[item.epistemic_state] ?? item.epistemic_state,
  }
}

export function getMapViewModel(): MapViewModel {
  const candidate = getOrCreateCandidate()
  const capabilities = listCapabilities(candidate.id)
  const capabilityEvidence = listCapabilityEvidenceIds(candidate.id)
  const evidence = listEvidence(candidate.id)
  const evidenceById = new Map(evidence.map((item) => [item.id, item]))
  const sourceNames = new Map(listSources(candidate.id).map((source) => [source.id, source.name]))
  const uncertainties = listUncertainties(candidate.id)
  const distinctiveIds = getDistinctiveProfile(candidate.id)

  const capabilityItems: CapabilityViewItem[] = capabilities.map((capability) => {
    const ids = capabilityEvidence.get(capability.id) ?? []
    const items = ids
      .map((id) => evidenceById.get(id))
      .filter((item): item is EvidenceRow => Boolean(item))
      .map((item) => evidenceToViewItem(item, sourceNames))
    return {
      id: capability.id,
      name: capability.name,
      strength: ASSESSMENT_TO_STRENGTH[capability.assessment] ?? 'limited',
      explanation: capability.reason,
      count: items.length,
      evidence: items,
    }
  })

  const gaps: GapViewItem[] = uncertainties
    .filter((uncertainty) => uncertainty.status === 'OPEN' && uncertainty.materiality !== 'LOW')
    .map((uncertainty) => ({
      id: uncertainty.id,
      name: uncertainty.capability_id
        ? (capabilities.find((capability) => capability.id === uncertainty.capability_id)?.name ??
          'Something unresolved')
        : 'Something unresolved',
      explanation: uncertainty.description,
      materiality: uncertainty.materiality,
    }))

  const distinctiveNames =
    distinctiveIds && distinctiveIds.length >= 2
      ? distinctiveIds
          .map((id) => capabilities.find((capability) => capability.id === id)?.name ?? null)
          .filter((name): name is string => Boolean(name))
      : null

  return {
    userZero: true,
    name: candidate.name,
    descriptor: candidate.descriptor,
    updated: `Last updated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`,
    capabilities: capabilityItems,
    gaps,
    distinctive: distinctiveNames,
    counts: {
      claims: listClaims(candidate.id).length,
      evidence: evidence.length,
      capabilities: capabilities.length,
      uncertaintiesOpen: uncertainties.filter((uncertainty) => uncertainty.status === 'OPEN').length,
      uncertaintiesResolved: uncertainties.filter((uncertainty) => uncertainty.status === 'RESOLVED').length,
      sources: listSources(candidate.id).length,
    },
  }
}

export function getListeningViewModel(): {
  evidenceCount: number
  capabilitiesCount: number
  listeningFor: string[]
  hasIntent: boolean
  intentConfirmed: boolean
  revealed: ListeningProfile['revealed']
  pendingReview: number
} {
  const candidate = getOrCreateCandidate()
  const intent = getLatestIntent(candidate.id)
  const profile = getListeningProfile(candidate.id)
  return {
    evidenceCount: listEvidence(candidate.id).length,
    capabilitiesCount: listCapabilities(candidate.id).length,
    listeningFor: profile.declared.items,
    hasIntent: Boolean(intent),
    intentConfirmed: profile.declared.confirmed,
    revealed: profile.revealed,
    pendingReview: profile.pendingReview,
  }
}

export interface DevTrace {
  candidate: { id: string; name: string | null; descriptor: string | null }
  sources: { id: string; type: string; name: string; status: string; detail: string | null; charCount: number | null }[]
  claims: { id: string; statement: string; type: string; epistemic: string; source: string | null; confidence: number | null }[]
  evidence: { id: string; statement: string; epistemic: string; sourceType: string; confirmed: boolean; turn: string | null }[]
  capabilities: { id: string; name: string; assessment: string; evidenceIds: string[]; reason: string }[]
  uncertainties: {
    id: string
    capability: string | null
    description: string
    materiality: string
    status: string
    resolvedByTurn: string | null
  }[]
  interview: {
    turns: {
      idx: number
      question: string | null
      reason: string | null
      answer: string | null
      targetUncertainties: string[]
      evidenceCreated: string[]
    }[]
    completed: boolean
  }
  modelRuns: {
    id: string
    task: string
    version: string
    model: string | null
    latencyMs: number | null
    ok: boolean
    error: string | null
    createdAt: string
  }[]
  evaluations: { targetType: string; targetId: string; verdict: string; comment: string | null; createdAt: string }[]
  distinctive: string[]
}

export function getDevTrace(): DevTrace {
  const candidate = getOrCreateCandidate()
  const capabilities = listCapabilities(candidate.id)
  const capabilityEvidence = listCapabilityEvidenceIds(candidate.id)
  const evidence = listEvidence(candidate.id)
  const evidenceIds = new Set(evidence.map((item) => item.id))
  const sources = listSources(candidate.id)
  const uncertainties = listUncertainties(candidate.id)
  const distinctiveIds = getDistinctiveProfile(candidate.id)

  const interviewRecord = getOrCreateInterview(candidate.id)
  const turns = listTurns(interviewRecord.id)

  return {
    candidate: { id: candidate.id, name: candidate.name, descriptor: candidate.descriptor },
    sources: sources.map((source) => ({
      id: source.id,
      type: source.type,
      name: source.name,
      status: source.status,
      detail: source.status_detail,
      charCount: source.char_count,
    })),
    claims: listClaims(candidate.id).map((claim) => ({
      id: claim.id,
      statement: claim.statement,
      type: claim.claim_type,
      epistemic: claim.epistemic_state,
      source: claim.source_id ? (sources.find((s) => s.id === claim.source_id)?.name ?? claim.source_id) : null,
      confidence: claim.confidence,
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      statement: item.statement,
      epistemic: item.epistemic_state,
      sourceType: sourceLabel(item.source_type),
      confirmed: item.candidate_confirmed === 1,
      turn: item.interview_turn_id,
    })),
    capabilities: capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      assessment: capability.assessment,
      evidenceIds: (capabilityEvidence.get(capability.id) ?? []).filter((id) => evidenceIds.has(id)),
      reason: capability.reason,
    })),
    uncertainties: uncertainties.map((uncertainty) => ({
      id: uncertainty.id,
      capability: uncertainty.capability_id,
      description: uncertainty.description,
      materiality: uncertainty.materiality,
      status: uncertainty.status,
      resolvedByTurn: uncertainty.resolved_by_turn,
    })),
    interview: {
      completed: interviewRecord.status === 'completed',
      turns: turns.map((turn) => ({
        idx: turn.idx,
        question: turn.question,
        reason: turn.question_reason,
        answer: turn.answer,
        targetUncertainties: parseJsonArray(turn.target_uncertainty_ids),
        evidenceCreated: evidence
          .filter((item) => item.interview_turn_id === turn.id)
          .map((item) => item.id),
      })),
    },
    modelRuns: listModelRuns(candidate.id, 200).map((run) => ({
      id: run.id,
      task: run.task,
      version: run.task_version,
      model: run.model_id,
      latencyMs: run.latency_ms,
      ok: run.ok === 1,
      error: run.error,
      createdAt: run.created_at,
    })),
    evaluations: listEvaluations(candidate.id).map((evaluation) => ({
      targetType: evaluation.target_type,
      targetId: evaluation.target_id,
      verdict: evaluation.verdict,
      comment: evaluation.comment,
      createdAt: evaluation.created_at,
    })),
    distinctive: distinctiveIds ?? [],
  }
}
