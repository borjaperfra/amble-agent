import { z } from 'zod'
import { getDb } from '../db/db'
import { listWanted } from '../db/matching'
import { candidateById, listCapabilities, listUncertainties } from '../db/repo'
import type { Explanation } from '../matching/assess'
import { buildMatchingProfile } from '../matching/profile'
import { getOpportunitiesView } from '../matching/view'
import { runStructuredTask } from '../model/provider'
import { getListeningProfile } from '../pipeline/listening'
import { recentMessages } from './conversation'
import { followupOutcomes } from './followups'
import { awaitingOf } from './offers'
import { pendingReminders } from './reminders'

// The Rep on WhatsApp, answering what someone writes. It knows what amble
// knows about them (their map, what it listens for and what it read this
// week, the offers it sent and their applications) and nothing else: an
// answer rests on that or says it does not know. It helps with their job
// search and only that, and it can act: prepare an application, note how
// one is going, propose a change to what it listens for (applied only on
// their yes). Anything about amble itself reaches the owner.

export const AGENT_VERSION = 'a3'

const SYSTEM_PROMPT = `You are the candidate's Rep at amble, talking to them on WhatsApp. amble listens to the job market for them and only interrupts when something truly fits. You help with their job search, and only that.

WHAT YOU CAN DO, and nothing else:
- Answer from what you know about them (below).
- Prepare an application for an offer they follow: the form's answers and advice, which they review and send themselves on the offer's own page. You never send an application for them.
- Note how an application is going when they tell you (they applied, got a call or an interview, were turned down, got an offer).
- Leave yourself a message to send them on a later day: the day after an interview they mention, to ask how it went; the day before a deadline they give you. Set "remind" to {"date": "YYYY-MM-DD", "message": the WhatsApp message to send that day, short and specific, in their language}. Only for a real date they gave you (work it out from TODAY), never more than one per message.
- Propose a change to what you listen for; it applies only when they confirm.
- Coach them on their career and search.
You cannot browse the web, look up a company, or see anything outside what is below.

WHAT YOU KNOW about them is below: their professional map (capabilities, what is still uncertain), what you listen for, what you read for them this week and why most of it was set aside, the offers you sent them on WhatsApp, the offers they follow, and the recent conversation. Use only this. If it does not answer their question (a detail an offer does not give, a company's policy), say plainly that you don't know, and suggest how they can find out. Never invent facts, numbers, companies or offers.

Decide what their message is, as "intent":
- "offer": about an offer you sent or one they follow. Answer from what you know of it.
- "applications": how their applications are going or what to do next with one. If they tell you news about one ("they called me", "I applied", "they said no"), set "action" to {"type": "application_update", "company", "status": "applied"|"interview"|"rejected"|"offer"} and acknowledge it naturally. If they ask you to apply or to prepare one, set "action" to {"type": "prepare_application", "company"}: you will offer to prepare it (they review it and send it themselves). Never for one they already applied to.
- "preferences": they want to change what you listen for. Only when the change is clear, propose it in "preference" (kind: "hard_filter" rules an offer out, "compensation" is pay, "strong" weighs a lot without ruling out; a short "label"; a one-sentence "statement" in their words where possible): they get buttons to confirm, so do not ask them to type yes. If it is ambiguous, ask your one question and leave "preference" null.
- "coach": advice on their career or search: how to present themselves for a kind of role, what to do about a gap, how to prepare an interview, how to approach a company, what to do next. Concrete, grounded in their map (their real capabilities and what is still uncertain), honest about gaps, one or two next steps at most. Never flatter. You may draft a short message or email for them when they give you what it is for.
- "amble": about amble itself: a problem, a suggestion, how it works, their account or data. Answer what you can ("Your data" in the app downloads or deletes their data) and set "forward": true so the team reads it. Why they get few offers is not a problem with amble: explain it from what you read this week.
- "smalltalk": thanks, greetings, acknowledgements. One line.
- "off_topic": anything that is not their job search. One kind sentence saying you are only here for their job search; do not answer the question.

Style: WhatsApp. Two to five short sentences; a short list only when it truly helps. Plain and warm, second person, no hype, no exclamation marks. Reply in the language of their message. Never assume their gender. The product is amble, lowercase.
Do not remind them of something still pending (a change to confirm, an offer to answer) unless they ask about it: its buttons are already there. Do not end messages with an offer of more help, and offer to prepare an application only when they ask for it.

"reaction": one emoji to react to their message with, as a person would, only for real news or real thanks (good news: 🙌, thanks: 👍); null otherwise, which is most of the time.

Respond ONLY with JSON: {"intent": "offer"|"applications"|"preferences"|"coach"|"amble"|"smalltalk"|"off_topic", "reply": string, "preference": {"kind": "hard_filter"|"compensation"|"strong", "label": string, "statement": string}|null, "action": {"type": "prepare_application"|"application_update", "company": string, "status": "applied"|"interview"|"rejected"|"offer"|null}|null, "remind": {"date": string, "message": string}|null, "forward": boolean, "reaction": string|null}.`

const INTENTS = ['offer', 'applications', 'preferences', 'coach', 'amble', 'smalltalk', 'off_topic'] as const
export type Intent = (typeof INTENTS)[number]
const STATUSES = ['applied', 'interview', 'rejected', 'offer'] as const
export type ApplicationStatus = (typeof STATUSES)[number]

export type AgentAction =
  | { type: 'prepare_application'; company: string }
  | { type: 'application_update'; company: string; status: ApplicationStatus }

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const agentSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const intent = text(obj.intent, 20).toLowerCase()
    const preference = obj.preference && typeof obj.preference === 'object' ? (obj.preference as Record<string, unknown>) : null
    const kind = text(preference?.kind, 20)
    const action = obj.action && typeof obj.action === 'object' ? (obj.action as Record<string, unknown>) : null
    const type = text(action?.type, 30)
    const status = text(action?.status, 20)
    return {
      intent: (INTENTS as readonly string[]).includes(intent) ? intent : 'smalltalk',
      reply: text(obj.reply, 1500),
      preference:
        preference && text(preference.statement, 400) && ['hard_filter', 'compensation', 'strong'].includes(kind)
          ? { kind, label: text(preference.label, 80), statement: text(preference.statement, 400) }
          : null,
      action:
        action && text(action.company, 120) && (type === 'prepare_application' || (type === 'application_update' && (STATUSES as readonly string[]).includes(status)))
          ? type === 'prepare_application'
            ? { type, company: text(action.company, 120) }
            : { type, company: text(action.company, 120), status }
          : null,
      remind: remindOf(obj.remind),
      forward: obj.forward === true,
      // One emoji, nothing else.
      reaction: /^\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*$/u.test(text(obj.reaction, 16)) ? text(obj.reaction, 16) : null,
    }
  },
  z.object({
    intent: z.enum(INTENTS),
    reply: z.string().min(1),
    preference: z.object({ kind: z.enum(['hard_filter', 'compensation', 'strong']), label: z.string(), statement: z.string() }).nullable(),
    action: z
      .union([
        z.object({ type: z.literal('prepare_application'), company: z.string() }),
        z.object({ type: z.literal('application_update'), company: z.string(), status: z.enum(STATUSES) }),
      ])
      .nullable(),
    remind: z.object({ date: z.string(), message: z.string() }).nullable(),
    forward: z.boolean(),
    reaction: z.string().nullable(),
  }),
)

// A day to come, within two months, and something to say then.
function remindOf(value: unknown): { date: string; message: string } | null {
  if (!value || typeof value !== 'object') return null
  const e = value as Record<string, unknown>
  const date = text(e.date, 10)
  const message = text(e.message, 600)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !message) return null
  const day = Date.parse(`${date}T00:00:00Z`)
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return day > today && day - today <= 62 * 24 * 60 * 60 * 1000 ? { date, message } : null
}

export interface AgentAnswer {
  intent: Intent
  reply: string
  preference: { kind: 'hard_filter' | 'compensation' | 'strong'; label: string; statement: string } | null
  action: AgentAction | null
  remind: { date: string; message: string } | null
  forward: boolean
  reaction: string | null
}

// Why what was read this week was set aside, counted: enough to explain why
// few offers reach them.
function thisWeek(candidateId: string) {
  const view = getOpportunitiesView(candidateId)
  const reasons: Record<string, number> = {}
  for (const item of view.discarded) {
    const kind = item.reasons[0]?.kind ?? 'no_reason'
    const label = kind === 'filter' ? `rule: ${(item.reasons[0] as { rule: string }).rule}` : kind
    reasons[label] = (reasons[label] ?? 0) + 1
  }
  return {
    readThisWeek: view.week.read,
    worthItThisWeek: view.week.worth,
    shownInTheAppNow: view.found.length + view.maybe.length,
    setAsideByReason: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8)),
  }
}

// Everything the agent may rest an answer on.
function contextFor(candidateId: string) {
  const candidate = candidateById(candidateId)
  const listening = getListeningProfile(candidateId)
  const profile = buildMatchingProfile(candidateId)
  const outcomes = followupOutcomes(candidateId)
  const pending = awaitingOf(candidateId)
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
    // With the weekday, so "on Thursday" can become a date.
    today: `${new Date().toISOString().slice(0, 10)} (${new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(new Date())})`,
    remindersAhead: pendingReminders(candidateId),
    name: candidate.name,
    listeningFor: {
      said: listening.declared.items,
      rulesOut: listening.revealed.rules.wontConsider.map((item) => item.statement),
      pay: listening.revealed.rules.money.map((item) => item.statement),
      weighs: listening.revealed.rules.weighs.map((item) => item.statement),
      notFilteringOn: listening.revealed.notFilteringOn.map((item) => item.label),
    },
    // A change you proposed and they have not confirmed yet.
    pendingChange: pending?.kind === 'preference' ? pending.preference.statement : null,
    whatYouReadForThem: thisWeek(candidateId),
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
    // The language of their message, not of their account.
    language: null,
  })
  return data
}
