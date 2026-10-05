import { z } from 'zod'
import { getOpportunityWithCompany } from '../db/opportunities'
import { candidateById, insertProposedPreference, listConfirmedPreferences, listProposedPreferences } from '../db/repo'
import { runStructuredTask } from '../model/provider'
import { UNTRUSTED_RULE, untrusted } from '../untrusted'

// A "not for me" with a reason ("ninguna de Microsoft encaja conmigo", "nada
// presencial") may say something about every offer like it, not only this
// one. When it does, a rule is proposed, never applied: it waits on
// /me/preferences for their yes, as a triage's proposals do (PRODUCT_SPEC
// §15.1). An answer about this offer alone ("ya apliqué por otra vía", "el
// equipo es muy pequeño para esto") proposes nothing.

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

export async function learnFromNo(candidateId: string, opportunityId: string, reason: string): Promise<void> {
  const candidate = candidateById(candidateId)
  // A few at a time: more waiting would read as a form to fill in.
  if (listProposedPreferences(candidate.id).filter((row) => row.source === 'offer').length >= PROPOSALS_WAITING) return
  const offer = getOpportunityWithCompany(opportunityId)
  if (!offer) return
  const rules = listConfirmedPreferences(candidate.id).map((row) => row.wording ?? row.statement)
  const { data, modelRunId } = await runStructuredTask({
    candidateId: candidate.id,
    task: 'learn_from_no',
    version: 'v1',
    system: SYSTEM_PROMPT,
    user: `THE OFFER: ${JSON.stringify({ company: offer.company_name, title: offer.title, location: offer.location, workplace: offer.workplace })}\n\nTHEIR REASON:\n${untrusted('reason', reason)}\n\nTHEIR RULES:\n${untrusted('rules', JSON.stringify(rules))}`,
    schema: outputSchema,
    temperature: 0.1,
  })
  if (!data.propose || !data.kind || !data.statement?.trim()) return
  insertProposedPreference({
    candidateId: candidate.id,
    kind: data.kind,
    statement: data.statement.trim(),
    label: data.label?.trim() || null,
    quote: reason.slice(0, 500),
    modelRunId,
    source: 'offer',
  })
}
