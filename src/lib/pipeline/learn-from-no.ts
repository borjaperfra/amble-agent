import { z } from 'zod'
import { getOpportunityWithCompany } from '../db/opportunities'
import { candidateById, insertProposedPreference, listConfirmedPreferences, listProposedPreferences } from '../db/repo'
import { aYearFromNow, excludeCompany } from '../db/excluded-companies'
import { runStructuredTask } from '../model/provider'
import { UNTRUSTED_RULE, untrusted } from '../untrusted'

// A "not for me" with a reason ("ninguna de Microsoft encaja conmigo", "nada
// presencial") may say something about every offer like it, not only this
// one. When it does, a rule is proposed, never applied without their yes
// (PRODUCT_SPEC §15.1), and asked at once, where they gave the reason (#42):
// in the app under the offers, in the chat with buttons. Unanswered in the
// app, it waits on /me/preferences as a triage's proposals do. An answer
// about this offer alone ("ya apliqué por otra vía", "el equipo es muy
// pequeño para esto") proposes nothing.
//
// A reason that turns down the company itself («no me gusta Canonical», «ya
// me rechazaron en Affirm», «ya trabajé allí») is not a proposal (#44): they
// said it, so nothing of that company comes again, applied at once and
// without the model (db/excluded-companies.ts), with a way to undo it. A
// company that turned them down: for a year, when most let them apply again.

const PROPOSALS_WAITING = 3

const outputSchema = z.object({
  company: z.enum(['dislike', 'rejected']).nullable().catch(null),
  propose: z.boolean(),
  kind: z.enum(['hard_filter', 'strong', 'compensation']).nullable(),
  label: z.string().max(60).nullable(),
  statement: z.string().max(300).nullable(),
})

const SYSTEM_PROMPT = `You are amble's listener for a "not for me", version 2. A person turned down a job offer amble showed them and said why. Decide whether their reason turns down THE COMPANY itself, and otherwise whether it states a preference about OTHER offers too, and if it does, write it as one rule.

${UNTRUSTED_RULE}

- company: "rejected" when they say this company already turned them down or will not let them apply again for a while ("ya me rechazaron", "they said no last month", "no puedo volver a aplicar"); "dislike" when they want nothing from this company at all ("no me gusta Canonical", "nada de esta empresa", "no me enseñes más de ellos", "ya trabajé allí y no vuelvo"); null otherwise, also when the reason is about this role, team or posting at that company and not the company. When company is not null, propose is false.

- propose true only when the reason is about a kind of offer, not this one alone: a company or kind of company they do not want ("nothing from Microsoft", "no consultancies"), a way of working ("nothing on-site"), a place, a pay level, a kind of role or level. False for a reason only about this offer (they already applied, this team or this title in particular, a detail of this posting), for vague dislike ("no me convence"), and when the rule is already among THEIR RULES.
- kind: "hard_filter" when they say they would not take such an offer at all; "compensation" when it is about pay; "strong" when it is a strong preference that should still let others through. Null when propose is false.
- label: the rule in a few words, in their language ("Nada de Microsoft"). statement: one sentence, in their language, that a reader of other offers can apply ("No offers from Microsoft or its subsidiaries" in their language). Both from what they said, never wider.
- Respond ONLY with JSON: {"company": "dislike"|"rejected"|null, "propose": boolean, "kind": "hard_filter"|"strong"|"compensation"|null, "label": string|null, "statement": string|null}.`

export interface NoRule {
  kind: 'hard_filter' | 'strong' | 'compensation'
  label: string | null
  statement: string
}

// Nothing more from this company: already applied when returned.
export interface CompanyExcluded {
  excluded: true
  companyId: string
  company: string
  until: string | null
}

// The company they turned down, now excluded; or the rule their reason
// states about other offers; or null: nothing kept.
export async function readNo(candidateId: string, opportunityId: string, reason: string, source: 'offer' | 'chat'): Promise<CompanyExcluded | (NoRule & { modelRunId: string | null }) | null> {
  const candidate = candidateById(candidateId)
  const offer = getOpportunityWithCompany(opportunityId)
  if (!offer) return null
  const rules = listConfirmedPreferences(candidate.id).map((row) => row.wording ?? row.statement)
  const { data, modelRunId } = await runStructuredTask({
    candidateId: candidate.id,
    task: 'learn_from_no',
    // They are asked about it at once (#42): not queued behind a pass.
    background: false,
    version: 'v2',
    system: SYSTEM_PROMPT,
    user: `THE OFFER: ${JSON.stringify({ company: offer.company_name, title: offer.title, location: offer.location, workplace: offer.workplace })}\n\nTHEIR REASON:\n${untrusted('reason', reason)}\n\nTHEIR RULES:\n${untrusted('rules', JSON.stringify(rules))}`,
    schema: outputSchema,
    temperature: 0.1,
  })
  if (data.company) {
    const until = data.company === 'rejected' ? aYearFromNow() : null
    excludeCompany(candidate.id, offer.company_id, { reason, until, source })
    return { excluded: true, companyId: offer.company_id, company: offer.company_name, until }
  }
  if (!data.propose || !data.kind || !data.statement?.trim()) return null
  return { kind: data.kind, label: data.label?.trim() || null, statement: data.statement.trim(), modelRunId }
}

// In the app: the company excluded, or the rule proposed, kept as a
// proposal, with its id to answer it.
export async function learnFromNo(candidateId: string, opportunityId: string, reason: string): Promise<CompanyExcluded | (NoRule & { id: string }) | null> {
  const rule = await readNo(candidateId, opportunityId, reason, 'offer')
  if (!rule || 'excluded' in rule) return rule
  // A few at a time: more waiting would read as a form to fill in. A
  // company turned down is not held back by them: it is not a question.
  if (listProposedPreferences(candidateId).filter((row) => row.source === 'offer').length >= PROPOSALS_WAITING) return null
  const id = insertProposedPreference({
    candidateId,
    kind: rule.kind,
    statement: rule.statement,
    label: rule.label,
    quote: reason.slice(0, 500),
    modelRunId: rule.modelRunId,
    source: 'offer',
  })
  return { id, kind: rule.kind, label: rule.label, statement: rule.statement }
}
