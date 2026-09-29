import { z } from 'zod'
import { getDb } from '../db/db'
import { listWanted } from '../db/matching'
import { candidateById, listCapabilities, listUncertainties } from '../db/repo'
import type { Explanation } from '../matching/assess'
import { buildMatchingProfile } from '../matching/profile'
import { runStructuredTask } from '../model/provider'
import { getListeningProfile } from '../pipeline/listening'
import { recentMessages } from './conversation'
import { followupOutcomes } from './followups'

// The Rep on WhatsApp, answering what someone writes. It knows what amble
// knows about them (their map, what it listens for, the offers it sent and
// their applications) and nothing else: an answer rests on that or says it
// does not know. It helps with their job search and only that: offers,
// applications, what it listens for, and advice on their career, as their
// coach. A change to what it listens for is only proposed; they confirm it.
// Anything about amble itself reaches the owner.

export const AGENT_VERSION = 'a1'

const SYSTEM_PROMPT = `You are the candidate's Rep at amble, talking to them on WhatsApp. amble listens to the job market for them and only interrupts when something truly fits. You help with their job search, and only that.

What you know about them is below: their professional map (capabilities, what is still uncertain), what you listen for, the offers you sent them on WhatsApp, the offers they wanted or applied to, and the recent conversation. Use only this. If they ask something it does not answer (a detail of an offer that is not there, a company's internal policy), say plainly that you don't know, and point them to the offer or to the app. Never invent facts, numbers, companies or offers.

Decide what their message is, as "intent":
- "offer": about an offer you sent or one they are following. Answer from what you know of it.
- "applications": how their applications are going, what to do next with one.
- "preferences": they want to change what you listen for ("no more hybrid", "my floor is now 80K", "I'd also consider product marketing"). Do not claim it is changed: propose the change in "preference" (kind: "hard_filter" for something that rules an offer out, "compensation" for pay, "strong" for something that weighs a lot without ruling out; a short "label"; and a "statement": one sentence, in their words where possible) and ask them to confirm.
- "coach": advice on their career or search: how to present themselves for a kind of role, what to do about a gap, how to approach a company, what their next step could be. Be their coach: concrete, grounded in their map (their real capabilities and what is still uncertain), honest about gaps, one or two next steps at most. Never flatter.
- "amble": about amble itself: a problem, a suggestion, a question about how it works, their account or data. Answer what you can (their data: "Your data" in the app lets them download or delete it) and set "forward": true so the team reads it.
- "smalltalk": thanks, greetings, acknowledgements. Answer in a line.
- "off_topic": anything that is not their job search (general questions, other tasks, other people). Say kindly, in one sentence, that you are only here to help with their job search, and do not answer the question itself.

Style: WhatsApp. Short: two to five sentences, no headings; a short list only when it truly helps. Plain and warm, second person, no hype, no exclamation marks. Never assume their gender. The product's name is amble, lowercase.

Respond ONLY with JSON: {"intent": "offer"|"applications"|"preferences"|"coach"|"amble"|"smalltalk"|"off_topic", "reply": string, "preference": {"kind": "hard_filter"|"compensation"|"strong", "label": string, "statement": string}|null, "forward": boolean}.`

const INTENTS = ['offer', 'applications', 'preferences', 'coach', 'amble', 'smalltalk', 'off_topic'] as const
export type Intent = (typeof INTENTS)[number]

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const agentSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const intent = text(obj.intent, 20).toLowerCase()
    const preference = obj.preference && typeof obj.preference === 'object' ? (obj.preference as Record<string, unknown>) : null
    const kind = text(preference?.kind, 20)
    return {
      intent: (INTENTS as readonly string[]).includes(intent) ? intent : 'smalltalk',
      reply: text(obj.reply, 1500),
      preference:
        preference && text(preference.statement, 400) && ['hard_filter', 'compensation', 'strong'].includes(kind)
          ? { kind, label: text(preference.label, 80), statement: text(preference.statement, 400) }
          : null,
      forward: obj.forward === true,
    }
  },
  z.object({
    intent: z.enum(INTENTS),
    reply: z.string().min(1),
    preference: z.object({ kind: z.enum(['hard_filter', 'compensation', 'strong']), label: z.string(), statement: z.string() }).nullable(),
    forward: z.boolean(),
  }),
)

export interface AgentAnswer {
  intent: Intent
  reply: string
  preference: { kind: 'hard_filter' | 'compensation' | 'strong'; label: string; statement: string } | null
  forward: boolean
}

// Everything the agent may rest an answer on.
function contextFor(candidateId: string) {
  const candidate = candidateById(candidateId)
  const listening = getListeningProfile(candidateId)
  const profile = buildMatchingProfile(candidateId)
  const outcomes = followupOutcomes(candidateId)
  const sentOnWhatsApp = getDb()
    .prepare(
      `SELECT s.answer, s.sent_at, m.explanation, o.title, o.url, o.location, o.workplace, o.salary_raw, c.name AS company
       FROM offer_sends s JOIN opportunity_matches m ON m.id = s.match_id
       JOIN opportunities o ON o.id = s.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE s.candidate_id = ? AND s.sent_at IS NOT NULL ORDER BY s.sent_at DESC LIMIT 10`,
    )
    .all(candidateId) as unknown as {
    answer: string | null
    sent_at: string
    explanation: string
    title: string
    url: string | null
    location: string | null
    workplace: string | null
    salary_raw: string | null
    company: string
  }[]
  return {
    name: candidate.name,
    listeningFor: {
      said: listening.declared.items,
      rulesOut: listening.revealed.rules.wontConsider.map((item) => item.statement),
      pay: listening.revealed.rules.money.map((item) => item.statement),
      weighs: listening.revealed.rules.weighs.map((item) => item.statement),
      notFilteringOn: listening.revealed.notFilteringOn.map((item) => item.label),
    },
    capabilities: listCapabilities(candidateId).map((capability) => ({ name: capability.name, assessment: capability.assessment })),
    experience: profile.experience,
    stillUncertain: listUncertainties(candidateId, 'OPEN')
      .slice(0, 8)
      .map((uncertainty) => uncertainty.description),
    offersSentOnWhatsApp: sentOnWhatsApp.map((row) => {
      const explanation = JSON.parse(row.explanation) as Explanation
      return {
        company: row.company,
        title: row.title,
        where: [row.location, row.workplace].filter(Boolean).join(' · '),
        salary: row.salary_raw,
        sentAt: row.sent_at.slice(0, 10),
        theirAnswer: row.answer,
        why: explanation.why.map((reason) => reason.text),
        considerAlso: explanation.considerAlso?.text ?? null,
        offerDoesNotSay: explanation.unknowns,
        url: row.url,
      }
    }),
    following: listWanted(candidateId)
      .slice(0, 15)
      .map((row) => ({
        company: row.company_name,
        title: row.title,
        state: row.progress ?? 'wanted',
        since: (row.progress_at ?? row.decided_at).slice(0, 10),
        whatTheySaidLater: outcomes.get(row.opportunity_id) ?? null,
        closed: row.closed_at !== null,
      })),
    conversation: recentMessages(candidateId).map((message) => `${message.direction === 'in' ? 'them' : 'you'}: ${message.body}`),
  }
}

export async function answerMessage(candidateId: string, message: string): Promise<AgentAnswer> {
  const { data } = await runStructuredTask({
    candidateId,
    task: 'whatsapp_agent',
    version: AGENT_VERSION,
    system: SYSTEM_PROMPT,
    user: `WHAT YOU KNOW:\n${JSON.stringify(contextFor(candidateId), null, 1)}\n\nTHEIR MESSAGE:\n${message}`,
    schema: agentSchema,
    temperature: 0.3,
  })
  return data
}
