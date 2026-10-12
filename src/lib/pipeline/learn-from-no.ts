import { z } from 'zod'
import { getOpportunityWithCompany } from '../db/opportunities'
import { candidateById, insertProposedPreference, listConfirmedPreferences, listProposedPreferences } from '../db/repo'
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

const PROPOSALS_WAITING = 3

const outputSchema = z.object({
  propose: z.boolean(),
  kind: z.enum(['hard_filter', 'strong', 'compensation']).nullable(),
  label: z.string().max(60).nullable(),
  statement: z.string().max(300).nullable(),
})

const SYSTEM_PROMPT = `You are amble's listener for a "not for me", version 1. A person turned down a job offer amble showed them and said why. Decide whether their reason states a preference about OTHER offers too, and if it does, write it as one rule.

${UNTRUSTED_RULE}

- propose true only when the reason is about a kind of offer, not this one alone: a company or kind of company they do not want ("nothing from Microsoft", "no consultancies"), a way of working ("nothing on-site"), a place, a pay level, a kind of role or level. False for a reason only about this offer (they already applied, this team or this title in particular, a detail of this posting), for vague dislike ("no me convence"), and when the rule is already among THEIR RULES.
- kind: "hard_filter" when they say they would not take such an offer at all; "compensation" when it is about pay; "strong" when it is a strong preference that should still let others through. Null when propose is false.
- label: the rule in a few words, in their language ("Nada de Microsoft"). statement: one sentence, in their language, that a reader of other offers can apply ("No offers from Microsoft or its subsidiaries" in their language). Both from what they said, never wider.
- Respond ONLY with JSON: {"propose": boolean, "kind": "hard_filter"|"strong"|"compensation"|null, "label": string|null, "statement": string|null}.`

export interface NoRule {
  kind: 'hard_filter' | 'strong' | 'compensation'
  label: string | null
  statement: string
}

// The rule their reason states about other offers, or null: nothing kept.
export async function readNo(candidateId: string, opportunityId: string, reason: string): Promise<(NoRule & { modelRunId: string | null }) | null> {
  const candidate = candidateById(candidateId)
  const offer = getOpportunityWithCompany(opportunityId)
  if (!offer) return null
  const rules = listConfirmedPreferences(candidate.id).map((row) => row.wording ?? row.statement)
  const { data, modelRunId } = await runStructuredTask({
    candidateId: candidate.id,
    task: 'learn_from_no',
    // They are asked about it at once (#42): not queued behind a pass.
    background: false,
    version: 'v1',
    system: SYSTEM_PROMPT,
    user: `THE OFFER: ${JSON.stringify({ company: offer.company_name, title: offer.title, location: offer.location, workplace: offer.workplace })}\n\nTHEIR REASON:\n${untrusted('reason', reason)}\n\nTHEIR RULES:\n${untrusted('rules', JSON.stringify(rules))}`,
    schema: outputSchema,
    temperature: 0.1,
  })
  if (!data.propose || !data.kind || !data.statement?.trim()) return null
  return { kind: data.kind, label: data.label?.trim() || null, statement: data.statement.trim(), modelRunId }
}

// In the app: the rule proposed, kept as a proposal, with its id to answer it.
export async function learnFromNo(candidateId: string, opportunityId: string, reason: string): Promise<(NoRule & { id: string }) | null> {
  // A few at a time: more waiting would read as a form to fill in.
  if (listProposedPreferences(candidateId).filter((row) => row.source === 'offer').length >= PROPOSALS_WAITING) return null
  const rule = await readNo(candidateId, opportunityId, reason)
  if (!rule) return null
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
