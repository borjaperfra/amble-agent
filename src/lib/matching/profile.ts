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
  // What the candidate said about the languages they speak, as said.
  languageClaims: string[]
  hash: string
}

// Claims that talk about spoken languages, not programming ones.
const LANGUAGE_CLAIM = /\b(languages?|idiomas?|speaker|native|nativo|nativa|fluent|fluido|fluida|bilingual|biling[uü]e)\b/i
const PROGRAMMING = /\bprogramming\b|\bprogramaci[oó]n\b/i

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

  const languageClaims = listClaims(candidateId)
    .filter((claim) => claim.claim_type === 'skill' && LANGUAGE_CLAIM.test(claim.statement) && !PROGRAMMING.test(claim.statement))
    .slice(0, 10)
    .map((claim) => claim.statement)

  // The fingerprint covers what changes a verdict: rules, what must not be
  // filtered on, capability levels and the languages spoken. When it moves, offers are judged again.
  const hash = createHash('sha1')
    .update(
      JSON.stringify({
        rules: rules.map((rule) => [rule.id, rule.statement]),
        notFilteringOn: listening.revealed.notFilteringOn.map((item) => [item.id, item.statement]),
        capabilities: capabilities.map((capability) => [capability.id, capability.assessment, capability.attributed]),
        languageClaims,
      }),
    )
    .digest('hex')
    .slice(0, 16)

  return { rules, notFilteringOn: listening.revealed.notFilteringOn, capabilities, experience, languageClaims, hash }
}
