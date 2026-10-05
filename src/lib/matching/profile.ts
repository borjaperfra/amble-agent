import { createHash } from 'node:crypto'
import { getStatedAbout, listCapabilities, listCapabilityEvidenceIds, listClaims, listEvidence, type StatedLanguage } from '../db/repo'
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
  // What they set themselves on /me/preferences: it wins over what the role
  // query would infer. Null where they have not said it.
  stated: { homeCountry: string | null; languages: StatedLanguage[] | null }
  hash: string
}

// Claims that talk about spoken languages, not programming ones.
// A language named ("inglés profesional", "español y valenciano") or a level
// ("B2/C1") says it as well as the word "idioma" does.
const LANGUAGE_CLAIM =
  /\b(languages?|idiomas?|lenguas?|speakers?|native|nativ[oa]s?|mother tongue|lengua materna|fluent|fluid[oa]s?|bilingual|biling[uü]es?|english|ingl[eé]s|spanish|espa[nñ]ol|castellano|catalan|catal[aá]n|valenciano|basque|euskera|galician|gallego|french|franc[eé]s|german|alem[aá]n|italian|italiano|portuguese|portugu[eé]s|dutch|neerland[eé]s|[ABC][12])\b/i
const PROGRAMMING = /\bprogramming\b|\bprogramaci[oó]n\b/i

const YEAR = /\b(19[89]\d|20[0-4]\d)\b/g
const ONGOING = /\b(present|current(ly)?|now|today|actualidad|actual(mente)?|hoy|presente)\b/i

// The latest year a statement of experience names, "to present" being this
// year; null when it names none.
function latestYear(statement: string): number | null {
  const years = [...statement.matchAll(YEAR)].map((match) => Number(match[1]))
  if (ONGOING.test(statement)) years.push(new Date().getFullYear())
  return years.length > 0 ? Math.max(...years) : null
}

// Dated statements newest first; undated ones after them, in the order read
// (a statement about a role usually follows the one that dates it).
export function byRecency(statements: string[]): string[] {
  const dated = statements.map((statement, index) => ({ statement, index, year: latestYear(statement) }))
  return [
    ...dated.filter((item) => item.year !== null).sort((a, b) => (b.year as number) - (a.year as number) || a.index - b.index),
    ...dated.filter((item) => item.year === null),
  ].map((item) => item.statement)
}

export function buildMatchingProfile(candidateId: string): MatchingProfile {
  const listening = getListeningProfile(candidateId)
  // Every rule they confirmed, whatever it came from (what they said, their
  // triage, WhatsApp, their own): one list (said-rules.ts).
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

  const claims = listClaims(candidateId)
  // Most recent first, before the cut: in the order they were read, a long
  // CV left its latest roles out, and early work weighed as much as today's.
  const experience = byRecency(claims.filter((claim) => claim.claim_type === 'experience').map((claim) => claim.statement)).slice(0, 30)

  const languageClaims = claims
    .filter((claim) => claim.claim_type === 'skill' && LANGUAGE_CLAIM.test(claim.statement) && !PROGRAMMING.test(claim.statement))
    .slice(0, 10)
    .map((claim) => claim.statement)

  const stated = getStatedAbout(candidateId)

  // The fingerprint covers what changes a verdict: rules, what must not be
  // filtered on, capability levels and the languages spoken. When it moves, offers are judged again.
  const hash = createHash('sha1')
    .update(
      JSON.stringify({
        // Whose profile it is: two people with the same rules are still two
        // people, and their assessments must never be shared.
        candidateId,
        rules: rules.map((rule) => [rule.id, rule.statement]),
        notFilteringOn: listening.revealed.notFilteringOn.map((item) => [item.id, item.statement]),
        capabilities: capabilities.map((capability) => [capability.id, capability.assessment, capability.attributed]),
        languageClaims,
        // Only once they set something: the fingerprint of everyone else, and
        // every assessment already made for them, stays as it was.
        ...(stated.homeCountry || stated.languages ? { stated } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 16)

  return { rules, notFilteringOn: listening.revealed.notFilteringOn, capabilities, experience, languageClaims, stated, hash }
}
