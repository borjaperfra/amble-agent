import {
  candidateById,
  decideRevealedPreference,
  getLatestOfferTriage,
  getRevealedPreference,
  insertCandidatePreference,
  listConfirmedPreferences,
  listProposedPreferences,
  listRevealedPreferences,
  LANGUAGE_LEVELS,
  renewRevealedPreference,
  reviseRevealedPreference,
  setStatedAbout,
  type LanguageLevel,
  type StatedLanguage,
  type RevealedPreferenceRow,
} from '../db/repo'
import { serverText } from '../i18n/candidate'
import { getListeningProfile, shortLabel } from './listening'
import { buildMatchingProfile } from '../matching/profile'
import { storedRoleQuery } from '../matching/role-query'

// What the Rep listens for, as one list they can change rule by rule
// (/me/preferences): every rule it applies, whatever it came from, grouped by
// what it does to an offer. What they say in their own words (/me/intent) and
// their sample offers (/me/triage) propose rules into this same list.

// What a rule does to an offer. weak and neutral both mean: never discard for it.
export type RuleGroup = 'never' | 'pay' | 'weighs' | 'notFor'
const GROUP_OF: Record<string, RuleGroup> = { hard_filter: 'never', compensation: 'pay', strong: 'weighs', weak: 'notFor', neutral: 'notFor' }
const KIND_OF: Record<RuleGroup, string> = { never: 'hard_filter', pay: 'compensation', weighs: 'strong', notFor: 'neutral' }

export interface RuleView {
  id: string
  group: RuleGroup
  // The rule as they read it, and its short form.
  text: string
  label: string
  // said | triage | chat | own | offer (from one they turned down) | null (before it was kept).
  // For one from an offer they turned down: what they wrote.
  quote: string | null
  source: string | null
  evidence: string | null
  triageId: string | null
  decidedAt: string | null
  // Confirmed long ago: no longer applied until they say it still holds.
  stale: boolean
}

export interface RulesView {
  rules: RuleView[]
  // What their latest sample offers suggest, waiting for their yes.
  proposed: RuleView[]
  // What decides offers without being a rule: where they live, what they work
  // in, and the floor actually applied. `stated`: set by them; otherwise what
  // the Rep worked out (null until it has).
  about: {
    homeCountry: string | null
    homeStated: boolean
    languages: { code: string; level: LanguageLevel | null }[]
    languagesStated: boolean
    floor: { amount: number; currency: string } | null
    // Countries beyond their region they asked for offers from.
    openTo: string[]
  }
}

export class RuleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'RuleError'
  }
}

function view(row: RevealedPreferenceRow): RuleView | null {
  const group = GROUP_OF[row.kind]
  // A self-filter is for talking about, never a rule (PRODUCT_SPEC §15.1): it stays in the triage.
  if (!group) return null
  return {
    id: row.id,
    group,
    text: row.wording ?? row.statement,
    label: shortLabel(row),
    // Rules written before their source was kept: from a triage when they came from its analysis.
    source: row.source ?? (row.origin === 'analysis' ? 'triage' : 'own'),
    quote: row.source === 'offer' ? row.quote : null,
    evidence: row.evidence,
    triageId: row.triage_id,
    decidedAt: row.decided_at,
    // No rule lapses with time (listening.ts).
    stale: false,
  }
}

export function getRulesView(candidateId: string): RulesView {
  const candidate = candidateById(candidateId)
  // Writes the rules of what they said, if they are not written yet.
  getListeningProfile(candidate.id)
  const rules = listConfirmedPreferences(candidate.id)
    .map((row) => view(row))
    .filter((item): item is RuleView => item !== null)
  const triage = getLatestOfferTriage(candidate.id)
  // What their latest triage suggests, and what an offer they turned down did.
  const proposed = [
    ...(triage?.status === 'analysed' ? listRevealedPreferences(triage.id).filter((row) => row.status === 'proposed') : []),
    ...listProposedPreferences(candidate.id),
  ]
    .map((row) => view(row))
    .filter((item): item is RuleView => item !== null)
  return { rules, proposed, about: aboutOf(candidate.id) }
}

function aboutOf(candidateId: string): RulesView['about'] {
  const profile = buildMatchingProfile(candidateId)
  // What the last read worked out, if it has been read with these rules.
  const query = storedRoleQuery(candidateId, profile)
  const { homeCountry, languages } = profile.stated
  return {
    homeCountry: homeCountry ?? query?.homeCountry ?? null,
    homeStated: homeCountry !== null,
    languages: languages ?? (query?.languages ?? []).map((code) => ({ code, level: null })),
    languagesStated: languages !== null,
    floor: query?.salaryFloor ? { amount: query.salaryFloor.amount, currency: query.salaryFloor.currency } : null,
    openTo: profile.stated.openTo ?? [],
  }
}

const COUNTRY = /^[A-Z]{2}$/
// A real ISO 639-1 language, by whether it has a name ("xx" has none).
const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })
const isLanguage = (code: string) => /^[a-z]{2}$/.test(code) && LANGUAGE_NAMES.of(code) !== undefined

// Where they live and the languages they work in, as they say them. An empty
// country or list means: work it out again from what they shared.
export function setAbout(candidateId: string, homeCountry: unknown, languages: unknown, openTo?: unknown): void {
  const candidate = candidateById(candidateId)
  const country = typeof homeCountry === 'string' && COUNTRY.test(homeCountry.trim().toUpperCase()) ? homeCountry.trim().toUpperCase() : null
  const list = Array.isArray(languages)
    ? languages
        .map((item) => ({ code: String((item as StatedLanguage)?.code ?? '').trim().toLowerCase(), level: (item as StatedLanguage)?.level }))
        .filter((item): item is StatedLanguage => isLanguage(item.code) && LANGUAGE_LEVELS.includes(item.level))
        .filter((item, index, all) => all.findIndex((other) => other.code === item.code) === index)
        .slice(0, 12)
    : []
  const open = Array.isArray(openTo) ? [...new Set(openTo.filter((code): code is string => typeof code === 'string' && COUNTRY.test(code.trim().toUpperCase())).map((code) => code.trim().toUpperCase()))].slice(0, 5) : []
  setStatedAbout(candidate.id, { homeCountry: country, languages: list.length > 0 ? list : null, openTo: open.length > 0 ? open : null })
}

function own(candidateId: string, id: string): RevealedPreferenceRow {
  const row = getRevealedPreference(id)
  if (!row || row.candidate_id !== candidateId) throw new RuleError(serverText().preferenceNotFound, 404)
  return row
}

function cleanText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length < 3) throw new RuleError(serverText().tooShort)
  return clean.slice(0, 500)
}

// Their words become the rule, as read and as matched on; the first change
// keeps what it said before. It holds from now: confirmed again today.
export function changeRule(candidateId: string, id: string, text: string): void {
  const row = own(candidateId, id)
  if (row.status !== 'confirmed' && row.status !== 'proposed') throw new RuleError(serverText().preferenceNotFound, 404)
  const clean = cleanText(text)
  reviseRevealedPreference(row.id, clean, clean.length <= 60 ? clean : null)
  if (row.status === 'proposed') decideRevealedPreference(row.id, 'confirmed')
  else renewRevealedPreference(row.id)
}

// Taken away: kept, as rejected, and no longer applied.
export function removeRule(candidateId: string, id: string): void {
  own(candidateId, id)
  decideRevealedPreference(id, 'rejected')
}

// A proposal from their sample offers, or a rule gone stale: yes, it holds.
export function keepRule(candidateId: string, id: string): void {
  const row = own(candidateId, id)
  if (row.status === 'proposed') decideRevealedPreference(row.id, 'confirmed')
  else if (row.status === 'confirmed') renewRevealedPreference(row.id)
  else throw new RuleError(serverText().preferenceNotFound, 404)
}

export function addRule(candidateId: string, group: string, text: string): string {
  const candidate = candidateById(candidateId)
  const kind = KIND_OF[group as RuleGroup]
  if (!kind) throw new RuleError('group must be one of: never, pay, weighs, notFor.')
  const clean = cleanText(text)
  return insertCandidatePreference({
    candidateId: candidate.id,
    triageId: null,
    kind,
    statement: clean,
    label: clean.length <= 60 ? clean : null,
    evidenceProbeIds: [],
    quote: null,
    source: 'own',
  }).id
}
