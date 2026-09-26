import { createHash } from 'node:crypto'
import { listCapabilities, listCapabilityEvidenceIds, listClaims, listEvidence } from '../db/repo'
import { isUnverifiedAssisted } from '../pipeline/attribution'
import { getListeningProfile, type ListeningItem } from '../pipeline/listening'

// What the matcher judges an offer against. Only confirmed, current
// preferences count (getListeningProfile already drops proposed, rejected,
// stale and self-filter ones).

export interface MatchingRule extends ListeningItem {
  kind: 'hard_filter' | 'compensation' | 'strong'
}

export interface MatchingCapability {
  id: string
  name: string
  assessment: string
  // False when the capability rests mostly on undefended co-produced work:
  // it cannot be offered to a company as individual skill (PRODUCT_SPEC §11.1).
  attributed: boolean
}

export interface MatchingProfile {
  rules: MatchingRule[]
  notFilteringOn: ListeningItem[]
  capabilities: MatchingCapability[]
  experience: string[]
  hash: string
}

export function buildMatchingProfile(candidateId: string): MatchingProfile {
  const listening = getListeningProfile(candidateId)
  const rules: MatchingRule[] = [
    ...listening.revealed.rules.wontConsider.map((item) => ({ ...item, kind: 'hard_filter' as const })),
    ...listening.revealed.rules.money.map((item) => ({ ...item, kind: 'compensation' as const })),
    ...listening.revealed.rules.weighs.map((item) => ({ ...item, kind: 'strong' as const })),
  ]

  const evidenceById = new Map(listEvidence(candidateId).map((item) => [item.id, item]))
  const links = listCapabilityEvidenceIds(candidateId)
  const capabilities = listCapabilities(candidateId)
    .filter((capability) => capability.assessment !== 'NO_EVIDENCE_YET')
    .map((capability) => {
      const linked = (links.get(capability.id) ?? []).map((id) => evidenceById.get(id)).filter((item) => item !== undefined)
      const unverified = linked.filter(isUnverifiedAssisted).length
      return {
        id: capability.id,
        name: capability.name,
        assessment: capability.assessment,
        attributed: !(linked.length > 0 && unverified * 2 > linked.length),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  const experience = listClaims(candidateId)
    .filter((claim) => claim.claim_type === 'experience')
    .slice(0, 30)
    .map((claim) => claim.statement)

  // The fingerprint covers what changes a verdict: rules, what must not be
  // filtered on, and capability levels. When it moves, offers are judged again.
  const hash = createHash('sha1')
    .update(
      JSON.stringify({
        rules: rules.map((rule) => [rule.id, rule.statement]),
        notFilteringOn: listening.revealed.notFilteringOn.map((item) => [item.id, item.statement]),
        capabilities: capabilities.map((capability) => [capability.id, capability.assessment, capability.attributed]),
      }),
    )
    .digest('hex')
    .slice(0, 16)

  return { rules, notFilteringOn: listening.revealed.notFilteringOn, capabilities, experience, hash }
}
