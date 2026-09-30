import {
  getDistinctiveProfile,
  getLatestIntent,
  candidateById,
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
import { candidateLocale } from './i18n/candidate'
import { getOpportunitiesView, type Drought, type WeekLedger } from './matching/view'

// An offer still in their hands, as an envelope on the listening horizon.
export interface PileEnvelope {
  id: string
  company: string
  title: string
  kind: 'new' | 'wanted' | 'sent'
}
import { dictionaries, type Dictionary } from './i18n/dictionaries'
import type { Locale } from './i18n/locale'

const ASSESSMENT_TO_STRENGTH: Record<string, EvidenceStrength> = {
  STRONG_EVIDENCE: 'strong',
  GOOD_EVIDENCE: 'good',
  SOME_EVIDENCE: 'some',
  LIMITED_EVIDENCE: 'limited',
  NO_EVIDENCE_YET: 'none',
  CONTRADICTORY_EVIDENCE: 'contradictory',
}

const STRENGTH_ORDER: EvidenceStrength[] = ['strong', 'good', 'some', 'limited', 'contradictory', 'none']

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

function evidenceToViewItem(item: EvidenceRow, sourceNames: Map<string, string>, t: Dictionary): EvidenceViewItem {
  const origin = item.source_id ? sourceNames.get(item.source_id) : null
  const excerpt = item.source_excerpt
  return {
    id: item.id,
    claim: item.statement,
    // Raw type: the interface labels it in the candidate's language.
    sourceType: item.source_type,
    date: item.created_at.slice(0, 10),
    confirmed: item.candidate_confirmed === 1,
    supports: excerpt
      ? origin
        ? t.evidence.fromSource(origin, excerpt)
        : `\u201C${excerpt}\u201D`
      : origin
        ? t.evidence.fromSourceOnly(origin)
        : t.evidence.fromInterview,
    epistemicState: t.evidence.epistemic[item.epistemic_state] ?? item.epistemic_state,
  }
}

export function getMapViewModel(candidateId: string, locale: Locale): MapViewModel {
  const t = dictionaries[locale]
  const candidate = candidateById(candidateId)
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
      .map((item) => evidenceToViewItem(item, sourceNames, t))
    return {
      id: capability.id,
      name: capability.name,
      strength: ASSESSMENT_TO_STRENGTH[capability.assessment] ?? 'limited',
      explanation: capability.reason,
      count: items.length,
      evidence: items,
    }
  })

  // What their work shows best comes first: the level, then how much backs
  // it. Stored, they are in the order they were last touched, which put
  // whatever the latest answer reassessed at the top.
  capabilityItems.sort((a, b) => STRENGTH_ORDER.indexOf(a.strength) - STRENGTH_ORDER.indexOf(b.strength) || b.count - a.count)

  // Only a few are shown: the ones that matter most, what an answer can
  // settle before what it cannot, and each about something different (three
  // doubts about one capability read as a verdict on it).
  const weight: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  const rank = new Map(capabilityItems.map((item, index) => [item.id, index]))
  // A doubt no answer can settle ("no outside source or certificate") is not
  // shown: it asks something of them they cannot give. Attribution doubts are
  // settled by defending the work, so they stay.
  const open = uncertainties
    .filter(
      (uncertainty) =>
        uncertainty.status === 'OPEN' &&
        uncertainty.materiality !== 'LOW' &&
        (uncertainty.resolvable_by_interview === 1 || uncertainty.kind === 'ATTRIBUTION'),
    )
    .sort(
      (a, b) =>
        (weight[a.materiality] ?? 3) - (weight[b.materiality] ?? 3) ||
        b.resolvable_by_interview - a.resolvable_by_interview ||
        (rank.get(a.capability_id ?? '') ?? capabilityItems.length) - (rank.get(b.capability_id ?? '') ?? capabilityItems.length),
    )
  const seen = new Set<string>()
  const first = open.filter((uncertainty) => {
    const about = uncertainty.capability_id ?? uncertainty.id
    if (seen.has(about)) return false
    seen.add(about)
    return true
  })
  const gaps: GapViewItem[] = [...first, ...open.filter((uncertainty) => !first.includes(uncertainty))]
    .map((uncertainty) => ({
      id: uncertainty.id,
      name: uncertainty.capability_id
        ? (capabilities.find((capability) => capability.id === uncertainty.capability_id)?.name ??
          t.evidence.somethingUnresolved)
        : t.evidence.somethingUnresolved,
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
    name: candidate.name,
    descriptor: candidate.descriptor,
    updated: t.evidence.lastUpdated(new Date().toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long' })),
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

// What they said they look for, as the Rep listens for it: everything in
// what they confirmed, since every part of it is applied (where they want to
// work and what they will not consider rule offers out, the salary is the
// floor). The stored list stops at eight and leaves out what they will not
// consider, which dropped their floor or their remote wish from the screen
// while offers were still judged by them.
function declaredItems(intent: ReturnType<typeof getLatestIntent>, profile: ListeningProfile, t: Dictionary['listening']): string[] {
  if (!intent?.confirmed_at) return profile.declared.items
  let groups: { label: string; values: string[] }[]
  try {
    groups = JSON.parse(intent.groups) as typeof groups
  } catch {
    return profile.declared.items
  }
  const values = (keep: (label: string) => boolean) =>
    groups.filter((group) => keep(group.label)).flatMap((group) => (group.values ?? []).map((value) => value.trim()).filter(Boolean))
  const items = [...values((label) => label !== 'Not interested in'), ...values((label) => label === 'Not interested in').map(t.notInterested)]
  return items.length > 0 ? [...new Set(items)] : profile.declared.items
}

export function getListeningViewModel(candidateId: string): {
  evidenceCount: number
  capabilitiesCount: number
  listeningFor: string[]
  hasIntent: boolean
  intentConfirmed: boolean
  revealed: ListeningProfile['revealed']
  pendingReview: number
  unseenOpportunities: number
  pile: PileEnvelope[]
  week: WeekLedger
  drought: Drought | null
} {
  const candidate = candidateById(candidateId)
  const intent = getLatestIntent(candidate.id)
  const profile = getListeningProfile(candidate.id)
  const opportunities = getOpportunitiesView(candidate.id)
  return {
    evidenceCount: listEvidence(candidate.id).length,
    capabilitiesCount: listCapabilities(candidate.id).length,
    listeningFor: declaredItems(intent, profile, dictionaries[candidateLocale(candidate)].listening),
    hasIntent: Boolean(intent),
    intentConfirmed: profile.declared.confirmed,
    revealed: profile.revealed,
    pendingReview: profile.pendingReview,
    unseenOpportunities: opportunities.unseen,
    // New to answer first, then what they want to send, then what went out.
    pile: [
      ...opportunities.found
        .filter((item) => !item.closed && !item.stale && item.response === null)
        .map((item) => ({ id: item.id, company: item.company, title: item.title, kind: 'new' as const })),
      ...opportunities.wanted
        .filter((item) => !item.closed)
        .map((item) => ({ id: item.key, company: item.company, title: item.title, kind: 'wanted' as const })),
      ...opportunities.sent.map((item) => ({ id: item.key, company: item.company, title: item.title, kind: 'sent' as const })),
    ],
    week: opportunities.week,
    drought: opportunities.drought,
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

export function getDevTrace(candidateId: string): DevTrace {
  const candidate = candidateById(candidateId)
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
      sourceType: item.source_type,
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
