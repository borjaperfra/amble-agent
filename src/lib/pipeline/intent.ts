import {
  confirmIntent,
  getCurrentIntent,
  getLatestIntent,
  candidateById,
  insertIntent,
  listConfirmedPreferences,
  newId,
  type IntentRow,
} from '../db/repo'
import { runInterpretIntentTask } from '../model/tasks'
import { serverText } from '../i18n/candidate'
import { getListeningProfile } from './listening'
import { syncSaidRules } from './said-rules'

export interface IntentGroups {
  label: string
  values: string[]
}

export interface IntentResult {
  id: string
  rawAnswer: string
  groups: IntentGroups[]
  listeningFor: string[]
  structured: boolean
}

// What they had confirmed, as groups; empty before they confirmed anything.
// What applies now of what they said, as groups: the rules it became, as they
// left them on /me/preferences (changed, or taken away one by one), not the
// answer as first written. Empty before they confirmed anything.
function confirmedGroups(candidateId: string): IntentGroups[] {
  if (!getCurrentIntent(candidateId)) return []
  // Writes them first, for an answer confirmed before rules were kept this way.
  getListeningProfile(candidateId)
  const groups = new Map<string, string[]>()
  for (const row of listConfirmedPreferences(candidateId)) {
    if (row.source !== 'said' || !row.declared) continue
    const values = (row.wording ?? row.statement).split(';').map((value) => value.trim()).filter(Boolean)
    groups.set(row.declared, [...(groups.get(row.declared) ?? []), ...values])
  }
  return [...groups].map(([label, values]) => ({ label, values }))
}

// Coming back to it changes what they had confirmed, never starts it over:
// the new answer is read against it, and the result (all of it) is what they
// review and confirm. Until they confirm, what they had stays in force
// (getCurrentIntent).
export async function interpretIntent(candidateId: string, answerText: string): Promise<IntentResult> {
  const candidate = candidateById(candidateId)
  const confirmed = confirmedGroups(candidate.id)
  try {
    // A busy model is waited for, and asked again, where every call is (provider.ts).
    const { data } = await runInterpretIntentTask({ candidateId: candidate.id, answer: answerText, confirmed })
    const row = insertIntent({
      id: newId('intn'),
      candidate_id: candidate.id,
      raw_answer: answerText,
      groups: JSON.stringify(data.groups),
      listening_for: JSON.stringify(data.listeningFor),
    })
    return {
      id: row.id,
      rawAnswer: answerText,
      groups: data.groups,
      listeningFor: data.listeningFor,
      structured: true,
    }
  } catch {
    // Not read: what they had confirmed stays, with their new words beside it.
    const words = { label: serverText().inYourWords, values: [answerText] }
    const row = insertIntent({
      id: newId('intn'),
      candidate_id: candidate.id,
      raw_answer: answerText,
      groups: JSON.stringify([...confirmed, { ...words, values: [answerText.slice(0, 120)] }]),
      listening_for: JSON.stringify([]),
    })
    return {
      id: row.id,
      rawAnswer: answerText,
      groups: [...confirmed, words],
      listeningFor: [],
      structured: false,
    }
  }
}

export function readLatestIntent(candidateId: string): IntentRow | undefined {
  return getLatestIntent(candidateId)
}

// What they look for, for the model that plans their questions: the roles,
// fields and companies they said (not where or for how much: those do not
// change which of their work matters), and the rules they confirmed. Empty
// until there is any.
export function lookingFor(candidateId: string): string {
  const lines: string[] = []
  // During the setup nothing is confirmed yet: what they just wrote is all there is.
  const intent = getCurrentIntent(candidateId) ?? getLatestIntent(candidateId)
  if (intent) {
    try {
      const groups = JSON.parse(intent.groups) as IntentGroups[]
      for (const group of groups) {
        if (['Role', 'Space', 'Company', 'Ownership', 'Other'].includes(group.label) && group.values?.length) lines.push(`${group.label}: ${group.values.join('; ')}`)
      }
    } catch {
      // An unreadable intent says nothing.
    }
  }
  // The rules they confirmed: what they will not do, and what weighs most.
  const { wontConsider, weighs } = getListeningProfile(candidateId).revealed.rules
  // Those from what they said are above already.
  for (const rule of [...wontConsider, ...weighs]) if (rule.source !== 'said') lines.push(`Rule: ${rule.statement}`)
  return lines.join('\n')
}

// False when the intent is not this candidate's.
export function confirmLatestIntent(candidateId: string, intentId: string, groups?: IntentGroups[]): boolean {
  const confirmed = confirmIntent(candidateId, intentId, groups)
  // What they confirmed is what the Rep applies from now on, as rules.
  if (confirmed) syncSaidRules(candidateId, true)
  return confirmed
}
