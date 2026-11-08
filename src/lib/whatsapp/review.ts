import { z } from 'zod'
import { descriptionsOf } from '../db/opportunities'
import type { MatchRow } from '../db/matching'
import type { Explanation } from '../matching/assess'
import type { MatchingProfile } from '../matching/profile'
import { runStructuredTask } from '../model/provider'

// A second reading, before an offer interrupts someone on WhatsApp. The first
// reading decided it deserves their attention; this one looks for why they
// would be let down by it, with the whole posting, their profile and the
// first reading's reasons in front of it. It only holds back: what it holds
// stays in the app, where they can still see it, but nothing buzzes. When it
// sends, it also writes the message, to them: the first reading's reasons
// are written about the candidate, for a page.

export const REVIEW_VERSION = 'r3'

const MAX_DESCRIPTION_CHARS = 12_000

const SYSTEM_PROMPT = `You are amble's second reader. Another reader has already judged that this job posting deserves this candidate's attention, and why. Before it is sent to them on WhatsApp, where it interrupts their day, you decide whether it truly does.

The candidate asked for few offers, each a very strong fit. Sending a mediocre one costs their trust; holding back a good one costs little, because it stays in the app. Be strict.

Read the whole posting against the candidate's rules, capabilities and experience, and the first reader's reasons. Look for what would disappoint them:
- the daily work is not what the title suggests, or not their kind of work;
- the seniority, scope or responsibility is clearly below or above them;
- something in the posting breaks one of their hard rules, even if the first reader missed it (location, remote, language, salary, the kind of work they refuse);
- the first reader's reasons rest on a stretch: a generic overlap, a keyword, a capability the posting does not actually need;
- the posting is vague, a pooled or evergreen listing, or reads like a recruiter or agency repost.

Decide:
- "send": a strong fit you would be glad to put in front of them today.
- "hold": anything less. Say the one reason in a short sentence.

When you send it, also write the WhatsApp message, addressed to the candidate in the second person, as their Rep would: plain, specific, no hype, no exclamation marks. It is read on a phone, between other things: short. The title, company, place and pay are already above it, so do not repeat them.
- "company": what the company does, in one plain sentence of at most 20 words for someone who has never heard of it, starting with what it does, as it follows "The company:" ("makes software that helps finance teams plan their budgets"; in Spanish, "hace software para …"), taken from the posting alone; null when the posting does not say. Never from what you know of the company yourself.
- "dayToDay": what they would do in this job, as two or three concrete tasks the posting names, in one sentence of at most 30 words starting with the first task, as it follows "Your day to day:" ("lead the data team, set the roadmap for the forecasting product and hire two engineers"; in Spanish, "liderar el equipo de datos, …"); null when the posting does not say. Not its requirements, perks or values.
- "summary": one sentence of at most 25 words: why the job is theirs, in plain words. Not what the company does or the tasks again.
- "reasons": 2 or 3 reasons of at most 20 words each, each taken from the FIRST READER's reasons: rephrase, never add a fact, a skill or a number that is not there. Each ties something the job asks for to something they have done (not a description of the job alone), and none repeats the summary.
- "caveat": the one thing that could make it a no, from the first reader's considerAlso or unknowns, in at most 25 words, said as a fact about the offer ("it does not say whether you can work from Spain"), never as a verdict of yours, and not that the pay is unpublished (the message already says so); or null.
Write in the language the task asks for, with no internal words: not "first reader", "rule", "filter", "floor" or "posting". Never assume their gender.

Respond ONLY with JSON: {"decision": "send"|"hold", "reason": string, "message": {"company": string|null, "dayToDay": string|null, "summary": string, "reasons": string[], "caveat": string|null}|null}.`

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const reviewSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const message = obj.message && typeof obj.message === 'object' ? (obj.message as Record<string, unknown>) : null
    return {
      decision: text(obj.decision, 10).toLowerCase() === 'send' ? 'send' : 'hold',
      reason: text(obj.reason, 400),
      message:
        message && text(message.summary, 400)
          ? {
              company: text(message.company, 300) || null,
              dayToDay: text(message.dayToDay, 400) || null,
              summary: text(message.summary, 400),
              reasons: (Array.isArray(message.reasons) ? message.reasons : []).map((reason) => text(reason, 300)).filter(Boolean).slice(0, 3),
              caveat: text(message.caveat, 300) || null,
            }
          : null,
    }
  },
  z.object({
    decision: z.enum(['send', 'hold']),
    reason: z.string(),
    message: z.object({ company: z.string().nullable(), dayToDay: z.string().nullable(), summary: z.string(), reasons: z.array(z.string()), caveat: z.string().nullable() }).nullable(),
  }),
)

// What goes on WhatsApp, in their words: "you", not "they".
export interface Pitch {
  // What the company does and what they would do there (#50), from the
  // posting; null when it does not say. Absent in pitches written before r3.
  company?: string | null
  dayToDay?: string | null
  summary: string
  reasons: string[]
  caveat: string | null
}

export interface Review {
  send: boolean
  reason: string
  pitch: Pitch | null
  modelRunId: string
}

export async function reviewForSending(params: {
  candidateId: string
  match: MatchRow & { title: string; company_name: string; location: string | null; workplace: string | null; salary_raw: string | null }
  profile: MatchingProfile
}): Promise<Review> {
  const { match, profile } = params
  const explanation = JSON.parse(match.explanation) as Explanation
  const description = descriptionsOf([match.opportunity_id]).get(match.opportunity_id) ?? ''
  const hardFilters = profile.rules.filter((rule) => rule.kind === 'hard_filter').map((rule) => rule.statement)
  const context = profile.rules.filter((rule) => rule.kind !== 'hard_filter').map((rule) => rule.statement)
  const { data, modelRunId } = await runStructuredTask({
    candidateId: params.candidateId,
    task: 'review_before_sending',
    version: REVIEW_VERSION,
    system: SYSTEM_PROMPT,
    user: `THEIR HARD RULES:\n${JSON.stringify(hardFilters, null, 1)}\n\nWHAT WEIGHS FOR THEM:\n${JSON.stringify(context, null, 1)}\n\nCAPABILITIES:\n${JSON.stringify(
      profile.capabilities.filter((capability) => capability.attributed).map((capability) => ({ name: capability.name, assessment: capability.assessment })),
      null,
      1,
    )}\n\nEXPERIENCE:\n${profile.experience.map((line) => `- ${line}`).join('\n') || '(none)'}\n\nFIRST READER:\n${JSON.stringify(
      {
        fit: explanation.roleFit,
        summary: explanation.summary,
        why: explanation.why.map((reason) => reason.text),
        considerAlso: explanation.considerAlso?.text ?? null,
        unknowns: explanation.unknowns,
      },
      null,
      1,
    )}\n\nPOSTING:\n${JSON.stringify(
      {
        company: match.company_name,
        title: match.title,
        location: match.location,
        workplace: match.workplace,
        salary: match.salary_raw,
        description: description.slice(0, MAX_DESCRIPTION_CHARS),
      },
      null,
      1,
    )}`,
    schema: reviewSchema,
    temperature: 0.1,
    background: true,
  })
  const send = data.decision === 'send'
  return { send, reason: data.reason, pitch: send ? data.message : null, modelRunId }
}
