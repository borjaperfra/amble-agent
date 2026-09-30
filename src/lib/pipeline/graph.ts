import {
  insertEvidence,
  insertUncertainty,
  listCapabilities,
  listClaimsWithoutEvidence,
  listEvidence,
  listSources,
  listUncertainties,
  newId,
  replaceDistinctiveProfile,
  uncertaintyExistsByDescription,
  updateCandidateProfile,
  upsertCapability,
  linkCapabilityEvidence,
  listCapabilityEvidenceIds,
  updateUncertaintyStatus,
  candidateById,
  getDistinctiveProfile,
  type ClaimRow,
  type EvidenceRow,
} from '../db/repo'
import {
  runAssessCapabilitiesTask,
  runDescriptorTask,
  runDistinctiveProfileTask,
  type EvidenceForAssessment,
} from '../model/tasks'
import { ASSISTED_SOURCE_TYPES, isUnverifiedAssisted } from './attribution'
import { serverText } from '../i18n/candidate'

export function claimsToEvidence(candidateId: string): number {
  const claims = listClaimsWithoutEvidence(candidateId)
  const sources = new Map(listSources(candidateId).map((source) => [source.id, source]))
  let created = 0

  for (const claim of claims) {
    const source = claim.source_id ? sources.get(claim.source_id) : undefined
    const sourceType = source?.type ?? 'interview'

    // PRODUCT_SPEC §11.1. What a co-produced artifact shows (SOURCE_FACT) stands.
    // What it was taken to say about the person's own judgment becomes an
    // assisted claim, and only a defence question can promote it.
    const assisted = ASSISTED_SOURCE_TYPES.has(sourceType)
    const epistemicState = assisted && claim.epistemic_state === 'USER_CLAIM' ? 'ASSISTED_CLAIM' : claim.epistemic_state

    const strength =
      epistemicState === 'VERIFIED_FACT'
        ? 'strong'
        : epistemicState === 'SOURCE_FACT' || epistemicState === 'USER_CLAIM'
          ? 'some'
          : 'limited'
    insertEvidence({
      id: newId('ev'),
      candidate_id: candidateId,
      claim_id: claim.id,
      statement: claim.statement,
      epistemic_state: epistemicState,
      source_type: sourceType,
      source_id: claim.source_id,
      source_excerpt: claim.source_excerpt,
      strength,
      confidence: claim.confidence,
      candidate_confirmed: epistemicState === 'USER_CLAIM' ? 1 : 0,
      human_verified: 0,
      interview_turn_id: claim.interview_turn_id,
      attribution: assisted ? 'assisted' : 'sole',
      defence_status: epistemicState === 'ASSISTED_CLAIM' ? 'undefended' : null,
    })
    created++
  }

  return created
}

const ABOVE_ASSISTED_CEILING = new Set(['STRONG_EVIDENCE', 'GOOD_EVIDENCE'])

// Models propose, domain rules decide. After a retraction the reassessment model
// may skip a capability, which would leave it at its old level with less under
// it. These rules hold whatever the model returned:
//   - a capability whose evidence was all retracted has no evidence
//   - a capability resting mostly on undefended assisted evidence is capped at SOME
export function reconcileCapabilities(candidateId: string): string[] {
  const evidenceById = new Map(listEvidence(candidateId).map((item) => [item.id, item]))
  const links = listCapabilityEvidenceIds(candidateId)
  const changed: string[] = []

  for (const capability of listCapabilities(candidateId)) {
    const linked = (links.get(capability.id) ?? [])
      .map((id) => evidenceById.get(id))
      .filter((item): item is EvidenceRow => item !== undefined)

    if (linked.length === 0) {
      if (capability.assessment === 'NO_EVIDENCE_YET') continue
      upsertCapability(
        candidateId,
        capability.id,
        capability.name,
        'NO_EVIDENCE_YET',
        serverText().evidenceRetracted,
      )
      changed.push(capability.id)
      continue
    }

    const unverified = linked.filter(isUnverifiedAssisted).length
    if (unverified * 2 > linked.length && ABOVE_ASSISTED_CEILING.has(capability.assessment)) {
      upsertCapability(
        candidateId,
        capability.id,
        capability.name,
        'SOME_EVIDENCE',
        `${capability.reason} — ${serverText().assistedCeiling(unverified, linked.length)}`.slice(0, 1000),
      )
      changed.push(capability.id)
    }
  }

  return changed
}

// PRODUCT_SPEC §14.1. A capability resting mostly on undefended assisted
// evidence carries attribution uncertainty, raised automatically. It is resolved
// only by defence: a second source proves nothing, it may have the same author.
export function syncAttributionUncertainties(candidateId: string, resolvedByTurn: string | null = null): number {
  const evidenceById = new Map(listEvidence(candidateId).map((item) => [item.id, item]))
  const links = listCapabilityEvidenceIds(candidateId)
  const openAttribution = listUncertainties(candidateId, 'OPEN').filter((row) => row.kind === 'ATTRIBUTION')
  let raised = 0

  for (const capability of listCapabilities(candidateId)) {
    const linked = (links.get(capability.id) ?? [])
      .map((id) => evidenceById.get(id))
      .filter((item): item is EvidenceRow => item !== undefined)
    const unverified = linked.filter(isUnverifiedAssisted).length
    const needsDefence = linked.length > 0 && unverified * 2 > linked.length
    const existing = openAttribution.find((row) => row.capability_id === capability.id)

    if (needsDefence && !existing) {
      insertUncertainty({
        id: newId('unc'),
        candidate_id: candidateId,
        capability_id: capability.id,
        description: serverText().attributionUnknown(capability.name, unverified, linked.length),
        reason: serverText().attributionReason,
        materiality: 'HIGH',
        status: 'OPEN',
        resolvable_by_interview: 1,
        kind: 'ATTRIBUTION',
      })
      raised++
    } else if (!needsDefence && existing) {
      updateUncertaintyStatus(existing.id, 'RESOLVED', resolvedByTurn, serverText().attributionResolved)
    }
  }

  return raised
}

function toAssessmentInput(evidence: EvidenceRow[]): EvidenceForAssessment[] {
  return evidence.map((item) => ({
    id: item.id,
    statement: item.statement,
    epistemicState: item.epistemic_state,
    sourceType: item.source_type,
    sourceExcerpt: item.source_excerpt,
    candidateConfirmed: item.candidate_confirmed === 1,
  }))
}

export interface CapabilityAssessmentResult {
  capabilityCount: number
  uncertaintyCount: number
  evidenceLinked: number
}

export async function assessCapabilities(
  candidateId: string,
  options?: { scopedEvidence?: EvidenceRow[] },
): Promise<CapabilityAssessmentResult> {
  const evidence = options?.scopedEvidence ?? listEvidence(candidateId)
  if (evidence.length === 0) {
    return { capabilityCount: 0, uncertaintyCount: 0, evidenceLinked: 0 }
  }

  const { data } = await runAssessCapabilitiesTask({
    candidateId,
    evidence: toAssessmentInput(evidence),
  })

  let evidenceLinked = 0
  let uncertaintyCount = 0
  const validEvidenceIds = new Set(evidence.map((item) => item.id))

  for (const capability of data.capabilities) {
    const evidenceIds = capability.evidenceIds.filter((id) => validEvidenceIds.has(id))
    if (evidenceIds.length === 0) continue
    upsertCapability(candidateId, capability.slug, capability.name, capability.assessment, capability.reason)
    linkCapabilityEvidence(candidateId, capability.slug, evidenceIds)
    evidenceLinked += evidenceIds.length
    for (const uncertainty of capability.uncertainties) {
      if (uncertaintyExistsByDescription(candidateId, uncertainty.description)) continue
      insertUncertainty({
        id: newId('unc'),
        candidate_id: candidateId,
        capability_id: capability.slug,
        description: uncertainty.description,
        reason: null,
        materiality: uncertainty.materiality,
        status: 'OPEN',
        resolvable_by_interview: uncertainty.materiality === 'LOW' ? 0 : 1,
      })
      uncertaintyCount++
    }
  }

  reconcileCapabilities(candidateId)
  uncertaintyCount += syncAttributionUncertainties(candidateId)

  return {
    capabilityCount: data.capabilities.length,
    uncertaintyCount,
    evidenceLinked,
  }
}

export async function buildDistinctiveProfile(candidateId: string): Promise<string[]> {
  const capabilities = listCapabilities(candidateId)
  const qualifying = capabilities
    .filter((c) => c.assessment === 'STRONG_EVIDENCE' || c.assessment === 'GOOD_EVIDENCE')
    .map((c) => ({ id: c.id, name: c.name, assessment: c.assessment, reason: c.reason }))

  if (qualifying.length < 2) {
    replaceDistinctiveProfile(candidateId, [])
    return []
  }

  try {
    const { data } = await runDistinctiveProfileTask({ candidateId, capabilities: qualifying })
    const validIds = data.capabilityIds.filter((id) => qualifying.some((c) => c.id === id))
    replaceDistinctiveProfile(candidateId, validIds)
    return validIds
  } catch {
    replaceDistinctiveProfile(candidateId, [])
    return []
  }
}

export async function buildDescriptor(candidateId: string): Promise<string | null> {
  const candidate = candidateById(candidateId)
  const capabilities = listCapabilities(candidateId)
  const substantive = capabilities.filter((c) => {
    const level = c.assessment
    return level === 'STRONG_EVIDENCE' || level === 'GOOD_EVIDENCE' || level === 'SOME_EVIDENCE'
  })

  if (substantive.length === 0) {
    updateCandidateProfile(candidate.id, candidate.name, null, false)
    return null
  }

  try {
    const { data } = await runDescriptorTask({
      candidateId,
      candidateName: candidate.name,
      capabilities: substantive.map((c) => ({ name: c.name, assessment: c.assessment })),
    })
    updateCandidateProfile(candidate.id, candidate.name, data.descriptor, true)
    return data.descriptor
  } catch {
    updateCandidateProfile(candidate.id, candidate.name, null, false)
    return null
  }
}

// The distinctive profile and descriptor are built from capability levels; when a
// level moves, what was derived from it must move too. Two model calls, at
// once (neither reads what the other writes), and nothing the next interview
// question depends on, so callers run it after answering the candidate rather
// than while they wait.
export async function refreshDerivedProfile(candidateId: string): Promise<void> {
  await Promise.all([buildDistinctiveProfile(candidateId), buildDescriptor(candidateId)])
}

export interface GraphBuildSummary {
  claimsConverted: number
  capabilities: CapabilityAssessmentResult
  distinctive: string[]
  descriptor: string | null
}

export async function buildGraph(candidateId: string): Promise<GraphBuildSummary> {
  const claimsConverted = claimsToEvidence(candidateId)
  const capabilities = await assessCapabilities(candidateId)
  const [distinctive, descriptor] = await Promise.all([buildDistinctiveProfile(candidateId), buildDescriptor(candidateId)])
  return { claimsConverted, capabilities, distinctive, descriptor }
}

export function newEvidenceFromClaim(claim: ClaimRow, turnId: string, candidateId: string): EvidenceRow {
  return insertEvidence({
    id: newId('ev'),
    candidate_id: candidateId,
    claim_id: claim.id,
    statement: claim.statement,
    epistemic_state: 'USER_CLAIM',
    source_type: 'interview',
    source_id: null,
    source_excerpt: claim.source_excerpt,
    strength: 'some',
    confidence: claim.confidence,
    candidate_confirmed: 1,
    human_verified: 0,
    interview_turn_id: turnId,
  })
}

export function openUncertaintiesFor(candidateId: string) {
  return listUncertainties(candidateId, 'OPEN')
}

export function getDistinctive(candidateId: string): string[] | null {
  return getDistinctiveProfile(candidateId)
}
