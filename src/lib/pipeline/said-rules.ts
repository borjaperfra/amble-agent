import { inTransaction } from '../db/db'
import { getCurrentIntent, replaceSaidPreferences, saidPreferencesState } from '../db/repo'

// What they said they look for, once confirmed, as rules beside every other
// rule the Rep applies (revealed_preferences, source 'said'). Before, these
// were worked out on each read, and stopped applying as soon as a triage
// existed, while the screens kept showing them: now they are rules like the
// rest, which a triage or WhatsApp can replace and they can change one by one.
//
// Where they want to work and what they will not consider rule offers out;
// what they asked to be paid is the floor; the rest weighs.
const KINDS: Record<string, { kind: 'hard_filter' | 'compensation' | 'strong'; lead: string }> = {
  Location: { kind: 'hard_filter', lead: 'Where they said they want to work' },
  'Not interested in': { kind: 'hard_filter', lead: 'What they said they will not consider' },
  Compensation: { kind: 'compensation', lead: 'What they said they want to be paid' },
  Role: { kind: 'strong', lead: 'The roles they said they want' },
  Space: { kind: 'strong', lead: 'The areas they said they want' },
  Company: { kind: 'strong', lead: 'The companies they said they want' },
  Ownership: { kind: 'strong', lead: 'The ownership they said they want' },
  Other: { kind: 'strong', lead: 'Also said' },
}

export function rulesFromGroups(groups: { label: string; values: string[] }[]): { kind: string; statement: string; label: string; wording: string; group: string }[] {
  return groups.flatMap((group) => {
    const known = KINDS[group.label]
    const values = (group.values ?? []).map((value) => value.trim()).filter(Boolean)
    // A group with no rule behind it ("in your words", when the answer could
    // not be read) is shown, not applied.
    if (!known || values.length === 0) return []
    return [{ kind: known.kind, statement: `${known.lead}: ${values.join('; ')}.`, label: values.join(', '), wording: values.join('; '), group: group.label }]
  })
}

// The rules of the answer they confirmed last, written once. Called when they
// confirm it, and on reading what the Rep listens for, so that an answer
// confirmed before rules were kept this way gets its rules the first time it
// is read.
// `confirming`: they have just confirmed it, maybe again with changes: its rules are written anew.
export function syncSaidRules(candidateId: string, confirming = false): void {
  const intent = getCurrentIntent(candidateId)
  if (!intent?.confirmed_at) return
  let groups: { label: string; values: string[] }[] = []
  try {
    groups = JSON.parse(intent.groups) as typeof groups
  } catch {
    return
  }
  const rules = rulesFromGroups(Array.isArray(groups) ? groups : [])
  const state = saidPreferencesState(candidateId, intent.id)
  // Written already, or nothing to write and nothing earlier to set aside.
  if ((state.written && !confirming) || (rules.length === 0 && state.active === 0)) return
  inTransaction(() => replaceSaidPreferences(candidateId, intent.id, intent.confirmed_at as string, rules, confirming))
}
