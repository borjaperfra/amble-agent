import { z } from 'zod'
import type { MatchVerdict } from '../db/matching'
import type { OpportunityRow } from '../db/opportunities'
import { runStructuredTask } from '../model/provider'
import type { MatchingProfile } from './profile'

// Judging one offer (PRODUCT_SPEC §17, §24): hard filters first, then the
// explanation. "The explanation is the product": never a match percentage.
//
// The model proposes; these rules decide what is stored:
//   - a filter fails only with a verbatim quote from the posting; otherwise it
//     is unknown, and missing information never discards an offer
//   - every reason to show an offer cites an attributed capability or the
//     posting verbatim; a reason resting on undefended co-produced work is
//     dropped (it would sell the candidate as more capable than they are)
//   - the verdict is computed here, not taken from the model

const MAX_DESCRIPTION_CHARS = 9_000

// Part of every stored assessment's key (with the profile fingerprint): a new
// version of this prompt means every offer is judged again.
export const ASSESS_VERSION = 'v6'

export type RoleFit = 'fits' | 'stretch' | 'wrong_role' | 'below_level'

export type GateResult = 'pass' | 'fail' | 'unknown'

export interface Gate {
  ruleId: string
  result: GateResult
  quote: string | null
  note: string
}

export interface Reason {
  text: string
  capabilityId: string | null
  quote: string | null
}

export interface Explanation {
  roleFit: { fit: RoleFit; reason: string }
  summary: string
  why: Reason[]
  considerAlso: { text: string; quote: string | null } | null
  unknowns: string[]
}

export interface Assessment {
  verdict: MatchVerdict
  gates: Gate[]
  explanation: Explanation
  dropped: { what: string; reason: string }[]
  modelRunId: string
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const strOrNull = (value: unknown, max: number): string | null => str(value, max) || null

const assessmentSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const gates = Array.isArray(obj.gates) ? obj.gates : []
    const why = Array.isArray(obj.why) ? obj.why : []
    const consider = obj.considerAlso && typeof obj.considerAlso === 'object' ? (obj.considerAlso as Record<string, unknown>) : null
    const fit = str((obj.roleFit as Record<string, unknown> | undefined)?.fit, 20).toLowerCase()
    return {
      roleFit: {
        fit: fit === 'fits' || fit === 'stretch' || fit === 'wrong_role' || fit === 'below_level' ? fit : 'stretch',
        reason: str((obj.roleFit as Record<string, unknown> | undefined)?.reason, 300),
      },
      gates: gates.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>
        const result = str(e.result, 10).toLowerCase()
        return {
          ruleId: str(e.ruleId, 60),
          result: result === 'pass' || result === 'fail' ? result : 'unknown',
          quote: strOrNull(e.quote, 400),
          note: str(e.note, 300),
        }
      }),
      summary: str(obj.summary, 400),
      why: why.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>
        return { text: str(e.text, 400), capabilityId: strOrNull(e.capabilityId, 120), quote: strOrNull(e.quote, 400) }
      }),
      considerAlso: consider && str(consider.text, 400) ? { text: str(consider.text, 400), quote: strOrNull(consider.quote, 400) } : null,
      unknowns: Array.isArray(obj.unknowns) ? obj.unknowns.map((item) => str(item, 300)).filter(Boolean).slice(0, 5) : [],
    }
  },
  z.object({
    roleFit: z.object({ fit: z.enum(['fits', 'stretch', 'wrong_role', 'below_level']), reason: z.string() }),
    gates: z.array(z.object({ ruleId: z.string(), result: z.enum(['pass', 'fail', 'unknown']), quote: z.string().nullable(), note: z.string() })),
    summary: z.string(),
    why: z.array(z.object({ text: z.string(), capabilityId: z.string().nullable(), quote: z.string().nullable() })).max(6),
    considerAlso: z.object({ text: z.string(), quote: z.string().nullable() }).nullable(),
    unknowns: z.array(z.string()),
  }),
)


const SYSTEM_PROMPT = `You are Amble's opportunity assessor, version 6. You read one job posting on behalf of one candidate and decide whether it deserves their attention, and why.

1. ROLE FIT, first. Is this a job this person could credibly do, given their capabilities and experience?
   - "fits": it is their kind of role.
   - "stretch": adjacent. Includes a different specialty within their own discipline (for someone in marketing and community: paid media, performance, lifecycle, PR, communications, social, content production). They could argue for it, but it is not their core.
   - "wrong_role": the daily work belongs to another discipline altogether: finance, engineering or software, data analysis, sales or account management, recruiting, design, legal, operations. A title word from their field does not change that. Never use it for another specialty of their own discipline. Say why in one sentence.
   - "below_level": clearly below this person's level, whatever the discipline: assistant, coordinator or executive-level execution for someone who has led the function, internships, entry-level, hourly or task-based gigs (posting, reviewing, evaluating content). Judge by the responsibility the posting describes, not only the title. Say why in one sentence.
   A title word like "marketing" does not make a role fit: judge what the person would do all day.

2. GATES: one for each HARD FILTER given, nothing else.
   - "fail": the posting clearly breaks it. "quote" must be words copied verbatim from the posting that by themselves show the violation. A true quote about something else is not evidence: if no words show the violation, the result is "unknown".
   - "pass": the posting clearly satisfies it.
   - "unknown": the posting does not say. Missing information is unknown, never fail.
   - The office locations listed for a REMOTE role are hubs, not requirements. They prove a location filter is broken only if the posting says where the remote work must be done from ("Remote - US", "must be based in", "US only").
   - A market named in the title or role ("Field Marketing - DACH", "B2B Marketing - Sweden", "Growth - Italy", "ASEAN") means the role serves that market and usually requires living there or speaking its language. Treat it as a location requirement unless the posting says the role can be done from elsewhere; the title words are a valid quote.
   CONTEXT (compensation insights and what weighs most for this person) is not a gate: use it in the explanation, never to discard.
   Conditions under NEVER FILTER ON must not be used against the offer.

3. EXPLANATION, only if the role is neither wrong_role nor below_level and no gate fails:
   - summary: one sentence, what this offer is for this person.
   - why: 1 to 4 reasons it deserves their attention. Each cites a capabilityId from the list (its id exactly) or a verbatim quote from the posting. Do not cite capabilities marked attributed:false as proof of skill.
   - considerAlso: the one thing that could make it a no, with a verbatim quote if the posting states it. If the role is a stretch, this is where you say so. Null if nothing.
   - unknowns: up to 5 things the posting does not say that matter to this person's rules (salary, office days, location...).

Never output a score or percentage. Plain, specific language; no hype.

Respond ONLY with JSON: {"roleFit": {"fit": "fits"|"stretch"|"wrong_role"|"below_level", "reason": string}, "gates": [{"ruleId": string, "result": "pass"|"fail"|"unknown", "quote": string|null, "note": string}], "summary": string, "why": [{"text": string, "capabilityId": string|null, "quote": string|null}], "considerAlso": {"text": string, "quote": string|null}|null, "unknowns": string[]}.`

// Words that turn a location into a restriction on where remote work is allowed.
const REMOTE_RESTRICTION = /\b(remote|remoto|only|based|resident|residents|citizens?|authori[sz]ed|amer|americas|emea|apac|latam)\b/i

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[“”«»"'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function assessOpportunity(params: {
  candidateId: string
  opportunity: OpportunityRow & { company_name: string }
  profile: MatchingProfile
}): Promise<Assessment> {
  const { opportunity, profile } = params
  const postingText = [
    opportunity.title,
    opportunity.location ?? '',
    opportunity.workplace ?? '',
    opportunity.salary_raw ?? '',
    (opportunity.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
  ].join('\n')
  const haystack = normalise(postingText)
  const inPosting = (quote: string | null) => quote !== null && quote.length >= 4 && haystack.includes(normalise(quote))

  // A list of places means different things by workplace. For an on-site or
  // hybrid role it is where you must be: proof. For a remote role (or one whose
  // workplace is unknown) it is where the company has offices: not proof,
  // unless the quote itself restricts where the work can be done from
  // ("Remote - US", "Remote, AMER", "US only").
  const locationField = normalise(opportunity.location ?? '')
  const onSiteRequired = opportunity.workplace === 'onsite' || opportunity.workplace === 'hybrid'
  const isHubListAsProof = (quote: string) =>
    !onSiteRequired && locationField.length > 0 && locationField.includes(normalise(quote)) && !REMOTE_RESTRICTION.test(quote)

  const posting = {
    company: opportunity.company_name,
    title: opportunity.title,
    location: opportunity.location,
    workplace: opportunity.workplace,
    salary:
      opportunity.salary_raw ??
      (opportunity.salary_min ? `${opportunity.salary_min}–${opportunity.salary_max ?? '?'} ${opportunity.salary_currency ?? ''}` : null),
    description: (opportunity.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
  }

  // Only hard filters gate. Compensation insights and strong preferences are
  // context: they shape the explanation and never discard on their own.
  const hardFilters = profile.rules.filter((rule) => rule.kind === 'hard_filter')
  const context = profile.rules.filter((rule) => rule.kind !== 'hard_filter')

  const { data, modelRunId } = await runStructuredTask({
    candidateId: params.candidateId,
    task: 'assess_opportunity',
    version: ASSESS_VERSION,
    system: SYSTEM_PROMPT,
    user: `HARD FILTERS:\n${JSON.stringify(hardFilters.map((r) => ({ id: r.id, rule: r.statement })), null, 1)}\n\nCONTEXT:\n${JSON.stringify(context.map((r) => ({ kind: r.kind, insight: r.statement })), null, 1)}\n\nNEVER FILTER ON:\n${JSON.stringify(profile.notFilteringOn.map((item) => item.statement), null, 1)}\n\nCAPABILITIES:\n${JSON.stringify(profile.capabilities, null, 1)}\n\nEXPERIENCE:\n${profile.experience.map((line) => `- ${line}`).join('\n') || '(none)'}\n\nPOSTING:\n${JSON.stringify(posting, null, 1)}`,
    schema: assessmentSchema,
    temperature: 0.2,
  })

  const dropped: Assessment['dropped'] = []
  const capabilityById = new Map(profile.capabilities.map((capability) => [capability.id, capability]))

  // Every hard filter gets exactly one gate; one the model skipped is unknown.
  const gates: Gate[] = hardFilters.map((rule) => {
    const proposed = data.gates.find((gate) => gate.ruleId === rule.id)
    if (!proposed) return { ruleId: rule.id, result: 'unknown', quote: null, note: '' }
    if (proposed.result === 'fail' && !inPosting(proposed.quote)) {
      dropped.push({ what: `gate ${rule.id}`, reason: 'fail without a verbatim quote from the posting' })
      return { ruleId: rule.id, result: 'unknown', quote: null, note: proposed.note }
    }
    if (proposed.result === 'fail' && isHubListAsProof(proposed.quote as string)) {
      dropped.push({ what: `gate ${rule.id}`, reason: 'office locations of a role that is not on-site or hybrid are not a requirement' })
      return { ruleId: rule.id, result: 'unknown', quote: null, note: proposed.note }
    }
    return { ...proposed, quote: proposed.quote && inPosting(proposed.quote) ? proposed.quote : null }
  })
  const failed = gates.some((gate) => gate.result === 'fail')
  // Another profession or a role below the candidate's level is never shown.
  const wrongRole = data.roleFit.fit === 'wrong_role' || data.roleFit.fit === 'below_level'

  const why: Reason[] = []
  for (const reason of data.why) {
    if (!reason.text) continue
    const capability = reason.capabilityId ? capabilityById.get(reason.capabilityId) : undefined
    const quoted = inPosting(reason.quote)
    if (capability && !capability.attributed && !quoted) {
      dropped.push({ what: reason.text, reason: `rests on unattributed capability ${capability.id}` })
      continue
    }
    if (!capability?.attributed && !quoted) {
      dropped.push({ what: reason.text, reason: 'cites no attributed capability and no verbatim posting quote' })
      continue
    }
    why.push({ text: reason.text, capabilityId: capability?.attributed ? capability.id : null, quote: quoted ? reason.quote : null })
  }

  const considerAlso = data.considerAlso
    ? { text: data.considerAlso.text, quote: inPosting(data.considerAlso.quote) ? data.considerAlso.quote : null }
    : null

  // Domain verdict: another profession or a broken hard filter is never shown,
  // whatever reasons the model found.
  const verdict: MatchVerdict = failed || wrongRole ? 'discarded' : why.length > 0 ? 'show' : 'hold'

  return {
    verdict,
    gates,
    explanation: { roleFit: data.roleFit, summary: data.summary, why, considerAlso, unknowns: data.unknowns },
    dropped,
    modelRunId,
  }
}
