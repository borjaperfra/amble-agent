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
  getOrCreateCandidate,
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

export function claimsToEvidence(candidateId: string): number {
  const claims = listClaimsWithoutEvidence(candidateId)
  const sources = new Map(listSources(candidateId).map((source) => [source.id, source]))
  let created = 0

  for (const claim of claims) {
    const source = claim.source_id ? sources.get(claim.source_id) : undefined
    const strength =
      claim.epistemic_state === 'VERIFIED_FACT'
        ? 'strong'
        : claim.epistemic_state === 'SOURCE_FACT' || claim.epistemic_state === 'USER_CLAIM'
          ? 'some'
          : 'limited'
    insertEvidence({
      id: newId('ev'),
      candidate_id: candidateId,
      claim_id: claim.id,
      statement: claim.statement,
      epistemic_state: claim.epistemic_state,
      source_type: source?.type ?? 'interview',
      source_id: claim.source_id,
      source_excerpt: claim.source_excerpt,
      strength,
      confidence: claim.confidence,
      candidate_confirmed: claim.epistemic_state === 'USER_CLAIM' ? 1 : 0,
      human_verified: 0,
      interview_turn_id: claim.interview_turn_id,
    })
    created++
  }

  return created
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
  const candidate = getOrCreateCandidate()
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

export interface GraphBuildSummary {
  claimsConverted: number
  capabilities: CapabilityAssessmentResult
  distinctive: string[]
  descriptor: string | null
}

export async function buildGraph(candidateId: string): Promise<GraphBuildSummary> {
  const claimsConverted = claimsToEvidence(candidateId)
  const capabilities = await assessCapabilities(candidateId)
  const distinctive = await buildDistinctiveProfile(candidateId)
  const descriptor = await buildDescriptor(candidateId)
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
