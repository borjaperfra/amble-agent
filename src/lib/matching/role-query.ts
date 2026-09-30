import { z } from 'zod'
import { getRoleQuery, insertRoleQuery } from '../db/matching'
import type { OpportunityRow } from '../db/opportunities'
import { runStructuredTask } from '../model/provider'
import { normaliseTitle } from '../sourcing/text'
import { cityAreaTerms, EUROPE, hasUnlistedPlaces, placeMatches, placeOf, remoteOutsideEurope } from './places'
import type { MatchingProfile } from './profile'

// The role query turns the profile into a free, deterministic prefilter: most
// of the 1,700 offers on the watched boards are for other professions, and
// judging each with the model would cost for nothing. The model proposes the
// query once per profile; applying it is plain string matching.
//
// Missing data never excludes: an offer without a location or workplace type
// passes to the model, which can read the description.

// Part of the stored query's key: a new version of the prompt means a new query.
const ROLE_QUERY_VERSION = 'v4'

export const SENIORITY_LEVELS = ['junior', 'mid_level', 'senior', 'staff', 'c_level'] as const
export type Seniority = (typeof SENIORITY_LEVELS)[number]

export interface RoleQuery {
  titleInclude: string[]
  titleExclude: string[]
  // Offers located only in these places are out (derived from hard filters).
  locationExclude: string[]
  // When a hard filter demands remote work: on-site or hybrid offers are out
  // unless located in one of officeAllowed.
  requireRemote: boolean
  officeAllowed: string[]
  // Where the candidate lives (ISO 3166-1 alpha-2), inferred from their
  // experience: it bounds where remote work is realistic. Null if unclear.
  homeCountry: string | null
  // Levels this person's experience makes credible, for aggregator searches.
  seniority: Seniority[]
  // The yearly salary below which an offer is a no, from a confirmed
  // compensation rule. Null when no confirmed rule states one.
  salaryFloor: { amount: number; currency: string; ruleId: string } | null
  // Languages the candidate works in (ISO 639-1), from what they said about
  // themselves. Empty when unknown: then no offer is judged on language.
  languages: string[]
}

const roleQuerySchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const list = (value: unknown, max: number) =>
      Array.isArray(value)
        ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => normaliseTitle(item)).filter(Boolean))].slice(0, max)
        : []
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
    return {
      titleInclude: list(obj.titleInclude, 40),
      titleExclude: list(obj.titleExclude, 60),
      locationExclude: list(obj.locationExclude, 40),
      locationRuleIds: ids(obj.locationRuleIds),
      requireRemote: obj.requireRemote === true,
      officeAllowed: list(obj.officeAllowed, 10),
      remoteRuleIds: ids(obj.remoteRuleIds),
      homeCountry: typeof obj.homeCountry === 'string' && /^[A-Za-z]{2}$/.test(obj.homeCountry.trim()) ? obj.homeCountry.trim().toUpperCase() : null,
      seniority: ids(obj.seniority).filter((level): level is Seniority => (SENIORITY_LEVELS as readonly string[]).includes(level)),
      salaryFloor: salaryFloorOf(obj.salaryFloor),
      languages: [...new Set(ids(obj.languages).map((code) => code.trim().toLowerCase()).filter((code) => /^[a-z]{2}$/.test(code)))],
    }
  },
  z.object({
    titleInclude: z.array(z.string()).min(3),
    titleExclude: z.array(z.string()),
    locationExclude: z.array(z.string()),
    locationRuleIds: z.array(z.string()),
    requireRemote: z.boolean(),
    officeAllowed: z.array(z.string()),
    remoteRuleIds: z.array(z.string()),
    homeCountry: z.string().nullable(),
    seniority: z.array(z.enum(SENIORITY_LEVELS)),
    salaryFloor: z.object({ amount: z.number(), currency: z.string(), ruleId: z.string() }).nullable(),
    languages: z.array(z.string()),
  }),
)

function salaryFloorOf(value: unknown): RoleQuery['salaryFloor'] {
  const floor = (value ?? {}) as Record<string, unknown>
  const amount = typeof floor.amount === 'number' ? floor.amount : Number(floor.amount)
  const currency = typeof floor.currency === 'string' ? floor.currency.trim().toUpperCase() : ''
  const ruleId = typeof floor.ruleId === 'string' ? floor.ruleId.trim() : ''
  // A yearly figure: anything under 1,000 is a monthly or hourly rate, or "75" for 75K.
  if (!Number.isFinite(amount) || amount < 1000 || !/^[A-Z]{3}$/.test(currency) || !ruleId) return null
  return { amount: Math.round(amount), currency, ruleId }
}

const SYSTEM_PROMPT = `You are Amble's role-query designer, version 3. You turn a candidate's profile into a cheap job-title prefilter applied to thousands of postings before any expensive reading. Postings are mostly written in English.

Output:
- titleInclude: 8 to 30 short lowercase words or phrases; a posting passes only if its title contains one. Cover every role family this person could credibly do, in English and in the candidate's own language (e.g. "marketing", "community", "developer relations", "devrel", "developer advocate", "growth", "content", "brand"). Recall matters more than precision here: a later stage reads each survivor carefully.
- titleExclude: lowercase words or phrases that make a title clearly wrong for this person even if it matched (e.g. "engineer", "intern", "account executive", "recruiter"). Never exclude a family the person could do.
- locationExclude: places where this person cannot take the job AT ALL, even remotely, because a confirmed hard filter rules the place out (e.g. a filter against US-based roles gives "united states", "usa", "us only", "new york", "san francisco"...). Never list a place only because working there would mean office days: that is what requireRemote and officeAllowed are for, and a remote job listed under that place must still pass. Empty if no hard filter is about location. locationRuleIds: the ids of the hard filters that justify it.
- requireRemote: true only if a confirmed hard filter demands remote work. officeAllowed: lowercase places where that filter still accepts some office days (empty if none). remoteRuleIds: the ids of the hard filters that justify it.
- homeCountry: the ISO 3166-1 alpha-2 code of the country the candidate lives in, only if the experience states it (a city or country). Null if unclear.
- seniority: the levels from ["junior", "mid_level", "senior", "staff", "c_level"] this person's experience makes credible to apply for. Usually one to three adjacent levels.
- salaryFloor: the gross yearly salary below which this person says no, only if a confirmed rule states it as a figure: {"amount": the full number (75000, not 75), "currency": ISO 4217 code, "ruleId": the id of the rule that states it}. When the rules give several figures, the one they call the real floor. Rules are listed newest first: when two rules state different floors, the newer one (listed first) is the floor, whatever the older one calls itself; the person changed their mind. Null if no rule states a floor.
- languages: ISO 639-1 codes of the languages this person can work in, only as LANGUAGES states them. Empty if it says nothing.

Only confirmed rules are given to you; do not invent constraints they do not state.

Respond ONLY with JSON: {"titleInclude": [], "titleExclude": [], "locationExclude": [], "locationRuleIds": [], "requireRemote": boolean, "officeAllowed": [], "remoteRuleIds": [], "homeCountry": string|null, "seniority": [], "salaryFloor": {"amount": number, "currency": string, "ruleId": string}|null, "languages": []}.`

export async function roleQueryFor(candidateId: string, profile: MatchingProfile): Promise<RoleQuery> {
  const key = `${profile.hash}:${ROLE_QUERY_VERSION}`
  const stored = getRoleQuery(candidateId, key)
  if (stored) return JSON.parse(stored.query) as RoleQuery

  const { data, modelRunId } = await runStructuredTask({
    candidateId,
    task: 'design_role_query',
    version: ROLE_QUERY_VERSION,
    // Filter terms, not prose: they must match English postings whatever the
    // candidate's language.
    language: null,
    system: SYSTEM_PROMPT,
    user: `CONFIRMED RULES:\n${JSON.stringify(
      profile.rules.map((rule) => ({ id: rule.id, kind: rule.kind, statement: rule.statement })),
      null,
      1,
    )}\n\nLANGUAGES:\n${profile.languageClaims.map((line) => `- ${line}`).join('\n') || '(none)'}\n\nCAPABILITIES:\n${JSON.stringify(profile.capabilities.map((c) => ({ name: c.name, assessment: c.assessment })), null, 1)}\n\nEXPERIENCE:\n${profile.experience.map((line) => `- ${line}`).join('\n') || '(none)'}`,
    schema: roleQuerySchema,
    temperature: 0.2,
  })

  // Domain rule: a location or remote constraint stands only on a confirmed
  // hard filter. Without one, the model's constraint is dropped.
  const hardFilterIds = new Set(profile.rules.filter((rule) => rule.kind === 'hard_filter').map((rule) => rule.id))
  const locationJustified = data.locationRuleIds.some((id) => hardFilterIds.has(id))
  const remoteJustified = data.remoteRuleIds.some((id) => hardFilterIds.has(id))
  const ruleIds = new Set(profile.rules.map((rule) => rule.id))
  const query: RoleQuery = {
    titleInclude: data.titleInclude,
    titleExclude: data.titleExclude.filter((term) => !data.titleInclude.includes(term)),
    locationExclude: locationJustified ? data.locationExclude : [],
    requireRemote: remoteJustified && data.requireRemote,
    officeAllowed: remoteJustified ? data.officeAllowed : [],
    homeCountry: data.homeCountry,
    seniority: data.seniority,
    // A floor stands only on a confirmed rule the candidate stated.
    salaryFloor: data.salaryFloor && ruleIds.has(data.salaryFloor.ruleId) ? data.salaryFloor : null,
    languages: profile.languageClaims.length > 0 ? data.languages : [],
  }
  insertRoleQuery(candidateId, key, query, modelRunId)
  return query
}

function containsTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${term} `)
}

// A title term in the forms titles write it: plural or singular of its last
// word ("events" for "event", "communication" for "communications"), and the
// person who does it ("marketer", "marketeer" for "marketing"). Recall only:
// every form names the same work.
function termForms(term: string): string[] {
  const forms = new Set([term, `${term}s`, `${term}es`])
  if (term.endsWith('s') && term.length > 4) forms.add(term.slice(0, -1))
  if (term.endsWith('ing') && term.length > 6) {
    const stem = term.slice(0, -3)
    for (const suffix of ['er', 'ers', 'eer', 'eers']) forms.add(`${stem}${suffix}`)
  }
  return [...forms]
}

function includesTerm(title: string, term: string): boolean {
  return termForms(term).some((form) => containsTerm(title, form))
}

// The same excluded word in the other languages of the region searched: an
// excluded "engineer" is also an "Ingeniero/a".
const SAME_WORD: Record<string, string[]> = {
  engineer: ['ingeniero', 'ingeniera', 'ingenieur', 'ingenieurin', 'ingegnere', 'engenheiro', 'engenheira'],
  developer: ['desarrollador', 'desarrolladora', 'entwickler', 'entwicklerin', 'developpeur', 'developpeuse', 'desenvolvedor', 'sviluppatore'],
  architect: ['arquitecto', 'arquitecta', 'architekt', 'architektin', 'architecte'],
}

function excludedForms(term: string): string[] {
  return [term, ...(SAME_WORD[term] ?? [])]
}

// Words of a place or of a pool of applicants, not of the work: "Comunidad
// Valenciana" is a region, the community of "Join our Talent Community" is no
// role. A title that still names a role without them ("Growth Marketing
// Manager (Talent Pool)") is still read; one that names a role in the pool
// ("Talent Community Manager") keeps it.
const NOT_ROLE_WORDS =
  /\b(comunidad (valenciana|de madrid|autonoma|foral)|valencian community|community of madrid|intelligence community|talent (community|pool|network)(?! (manager|lead|specialist|coordinator|partner|director|head|owner|program)))\b/g

// "Developer Relations Engineer", "Product Marketing Engineer": the excluded
// word is the noun of a role family the candidate does, named in full just
// before it, in the raw title (no comma or dash between). The excluded word
// then says how technical that role is, which the model weighs against the
// candidate's rules; a filter on words must not decide it.
function excludedWordIsRoleNoun(rawTitle: string, include: string, excluded: string): boolean {
  if (!include.includes(' ')) return false
  const words = (text: string) => text.split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+')
  return new RegExp(`(^|[^a-z0-9])${words(include)}\\s+(\\S+\\s+)?${words(excluded)}s?($|[^a-z0-9])`).test(
    rawTitle.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  )
}

function locationSegments(location: string | null): string[] {
  if (!location) return []
  return location
    .split(/[·;|/]|\s-\s/)
    .map((segment) => normaliseTitle(segment))
    .filter(Boolean)
}

export type PrefilterResult = { pass: true } | { pass: false; reason: string }

// Titles that name a level below anything a candidate past junior would take,
// in the languages of the region searched. Not a preference: a floor.
const BELOW_LEVEL_TERMS = [
  'intern',
  'internship',
  'trainee',
  'apprentice',
  'apprenticeship',
  'junior',
  'jr',
  'entry level',
  'graduate',
  'assistant',
  'asistente',
  'assistente',
  'assistante',
  'werkstudent',
  'working student',
  'student',
  'praktikum',
  'praktikant',
  'stagiaire',
  'becario',
  'becaria',
  'practicas',
  'tirocinio',
  'alternance',
  'beca',
  'becas',
  'estagio',
  'estagiario',
  'estagiaria',
  'stagiair',
  'volontar',
  'volontariat',
  'minijob',
]

// "Stage" is French for internship, but "early stage" is a company, not a level.
const INTERNSHIP_STAGE = /(^| )stage( |$)/
const COMPANY_STAGE = /(early|late|growth|seed|multi) stage/

// "$15/hr", "€20 per hour": hourly gigs, whatever the title says. Checked on the
// raw title, since normalising drops the currency and the slash.
const HOURLY_PAY = /[$€£]\s?\d+(?:[.,]\d+)?\s?\/\s?(?:hr|hour|h)\b|\bper hour\b/i

function belowLevel(rawTitle: string, title: string): string | null {
  if (HOURLY_PAY.test(rawTitle)) return 'hourly'
  const term = BELOW_LEVEL_TERMS.find((candidate) => containsTerm(title, candidate))
  if (term) return term
  if (INTERNSHIP_STAGE.test(title) && !COMPANY_STAGE.test(title)) return 'stage'
  return null
}

export function prefilter(opportunity: Pick<OpportunityRow, 'title' | 'location' | 'workplace'>, query: RoleQuery): PrefilterResult {
  const title = normaliseTitle(opportunity.title)
  const roleWords = title.replace(NOT_ROLE_WORDS, ' ').replace(/\s+/g, ' ').trim()
  const included = query.titleInclude.filter((term) => includesTerm(roleWords, term))
  if (included.length === 0) return { pass: false, reason: 'title' }
  const excluded = query.titleExclude.find(
    (term) =>
      excludedForms(term).some((form) => containsTerm(title, form)) &&
      // A level is never a role's noun: "Community Intern" stays out.
      (BELOW_LEVEL_TERMS.includes(term) || !included.some((include) => excludedWordIsRoleNoun(opportunity.title, include, term))),
  )
  if (excluded) return { pass: false, reason: `title:${excluded}` }

  // Domain rule: when the candidate's credible levels start above junior, a
  // below-level title never reaches the model (nor spends its cost).
  if (query.seniority.length > 0 && !query.seniority.includes('junior')) {
    const below = belowLevel(opportunity.title, title)
    if (below) return { pass: false, reason: `level:${below}` }
  }

  const segments = locationSegments(opportunity.location)
  // Listed places only: "Remote - India" is one place, not "Remote" and
  // "India"; so are "USA - Wichita, KS" and "Massachusetts - Boston".
  const listed = (opportunity.location ?? '').split(/[·;|/•]/).filter((item) => item.trim())
  // Places a board counts but does not name ("(+6)") are unknown, and the
  // unknown never excludes.
  const unlisted = hasUnlistedPlaces(opportunity.location)
  // "Remote - US" is one place, the US: the way of working is not a place.
  const places = listed.map(placeOf).filter((place): place is string => place !== null)
  // Out only if every listed place is excluded: one acceptable place keeps it.
  if (
    !unlisted &&
    places.length > 0 &&
    query.locationExclude.length > 0 &&
    places.every((place) => query.locationExclude.some((term) => placeMatches(place, term)))
  ) {
    return { pass: false, reason: 'location' }
  }

  // Domain rule: remote work tied to a place outside the candidate's region is
  // not open to them, whatever they prefer ("Remote - India" for someone in
  // Madrid). Not a preference, so no confirmed rule is needed. Every segment
  // must be so tied: a bare "Remote" among them leaves it to the model. Only
  // for Europe, the region the rule knows.
  const remote = opportunity.workplace === 'remote' || segments.some((segment) => /\b(remote|remoto)\b/.test(segment))
  if (!unlisted && remote && query.homeCountry && EUROPE.includes(query.homeCountry) && listed.length > 0 && listed.every(remoteOutsideEurope)) {
    return { pass: false, reason: 'region' }
  }

  if (query.requireRemote && (opportunity.workplace === 'onsite' || opportunity.workplace === 'hybrid')) {
    const inAllowedOffice = segments.some((segment) =>
      query.officeAllowed.some((term) => cityAreaTerms(term).some((town) => containsTerm(segment, town))),
    )
    if (!inAllowedOffice) return { pass: false, reason: 'workplace' }
  }

  return { pass: true }
}
