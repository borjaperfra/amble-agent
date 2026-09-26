import { z } from 'zod'
import { getRoleQuery, insertRoleQuery } from '../db/matching'
import type { OpportunityRow } from '../db/opportunities'
import { runStructuredTask } from '../model/provider'
import { normaliseTitle } from '../sourcing/text'
import type { MatchingProfile } from './profile'

// The role query turns the profile into a free, deterministic prefilter: most
// of the 1,700 offers on the watched boards are for other professions, and
// judging each with the model would cost for nothing. The model proposes the
// query once per profile; applying it is plain string matching.
//
// Missing data never excludes: an offer without a location or workplace type
// passes to the model, which can read the description.

// Part of the stored query's key: a new version of the prompt means a new query.
const ROLE_QUERY_VERSION = 'v2'

export interface RoleQuery {
  titleInclude: string[]
  titleExclude: string[]
  // Offers located only in these places are out (derived from hard filters).
  locationExclude: string[]
  // When a hard filter demands remote work: on-site or hybrid offers are out
  // unless located in one of officeAllowed.
  requireRemote: boolean
  officeAllowed: string[]
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
  }),
)

const SYSTEM_PROMPT = `You are Amble's role-query designer, version 2. You turn a candidate's profile into a cheap job-title prefilter applied to thousands of postings before any expensive reading. Postings are mostly written in English.

Output:
- titleInclude: 8 to 30 short lowercase words or phrases; a posting passes only if its title contains one. Cover every role family this person could credibly do, in English and in the candidate's own language (e.g. "marketing", "community", "developer relations", "devrel", "developer advocate", "growth", "content", "brand"). Recall matters more than precision here: a later stage reads each survivor carefully.
- titleExclude: lowercase words or phrases that make a title clearly wrong for this person even if it matched (e.g. "engineer", "intern", "account executive", "recruiter"). Never exclude a family the person could do.
- locationExclude: places where this person cannot take the job AT ALL, even remotely, because a confirmed hard filter rules the place out (e.g. a filter against US-based roles gives "united states", "usa", "us only", "new york", "san francisco"...). Never list a place only because working there would mean office days: that is what requireRemote and officeAllowed are for, and a remote job listed under that place must still pass. Empty if no hard filter is about location. locationRuleIds: the ids of the hard filters that justify it.
- requireRemote: true only if a confirmed hard filter demands remote work. officeAllowed: lowercase places where that filter still accepts some office days (empty if none). remoteRuleIds: the ids of the hard filters that justify it.

Only confirmed rules are given to you; do not invent constraints they do not state.

Respond ONLY with JSON: {"titleInclude": [], "titleExclude": [], "locationExclude": [], "locationRuleIds": [], "requireRemote": boolean, "officeAllowed": [], "remoteRuleIds": []}.`

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
    )}\n\nCAPABILITIES:\n${JSON.stringify(profile.capabilities.map((c) => ({ name: c.name, assessment: c.assessment })), null, 1)}\n\nEXPERIENCE:\n${profile.experience.map((line) => `- ${line}`).join('\n') || '(none)'}`,
    schema: roleQuerySchema,
    temperature: 0.2,
  })

  // Domain rule: a location or remote constraint stands only on a confirmed
  // hard filter. Without one, the model's constraint is dropped.
  const hardFilterIds = new Set(profile.rules.filter((rule) => rule.kind === 'hard_filter').map((rule) => rule.id))
  const locationJustified = data.locationRuleIds.some((id) => hardFilterIds.has(id))
  const remoteJustified = data.remoteRuleIds.some((id) => hardFilterIds.has(id))
  const query: RoleQuery = {
    titleInclude: data.titleInclude,
    titleExclude: data.titleExclude.filter((term) => !data.titleInclude.includes(term)),
    locationExclude: locationJustified ? data.locationExclude : [],
    requireRemote: remoteJustified && data.requireRemote,
    officeAllowed: remoteJustified ? data.officeAllowed : [],
  }
  insertRoleQuery(candidateId, key, query, modelRunId)
  return query
}

function containsTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${term} `)
}

function locationSegments(location: string | null): string[] {
  if (!location) return []
  return location
    .split(/[·;|/]|\s-\s/)
    .map((segment) => normaliseTitle(segment))
    .filter(Boolean)
}

export type PrefilterResult = { pass: true } | { pass: false; reason: string }

export function prefilter(opportunity: Pick<OpportunityRow, 'title' | 'location' | 'workplace'>, query: RoleQuery): PrefilterResult {
  const title = normaliseTitle(opportunity.title)
  if (!query.titleInclude.some((term) => containsTerm(title, term))) return { pass: false, reason: 'title' }
  const excluded = query.titleExclude.find((term) => containsTerm(title, term))
  if (excluded) return { pass: false, reason: `title:${excluded}` }

  const segments = locationSegments(opportunity.location)
  // Out only if every listed place is excluded: one acceptable place keeps it.
  if (
    segments.length > 0 &&
    query.locationExclude.length > 0 &&
    segments.every((segment) => query.locationExclude.some((term) => containsTerm(segment, term)))
  ) {
    return { pass: false, reason: 'location' }
  }

  if (query.requireRemote && (opportunity.workplace === 'onsite' || opportunity.workplace === 'hybrid')) {
    const inAllowedOffice = segments.some((segment) => query.officeAllowed.some((term) => containsTerm(segment, term)))
    if (!inAllowedOffice) return { pass: false, reason: 'workplace' }
  }

  return { pass: true }
}
