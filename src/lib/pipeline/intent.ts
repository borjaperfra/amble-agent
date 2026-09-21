import {
  confirmIntent,
  getLatestIntent,
  insertIntent,
  newId,
  type IntentRow,
} from '../db/repo'
import { runInterpretIntentTask } from '../model/tasks'
import { applyExtractedPreferences, readPreferences, type Preferences } from './preferences'

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
  /** Pre-filled from the same answer, for the candidate to correct. */
  preferences: Preferences
}

export async function interpretIntent(
  candidateId: string,
  answerText: string,
): Promise<IntentResult> {
  try {
    const { data } = await runInterpretIntentTask({ candidateId, answer: answerText })
    const row = insertIntent({
      id: newId('intn'),
      candidate_id: candidateId,
      raw_answer: answerText,
      groups: JSON.stringify(data.groups),
      listening_for: JSON.stringify(data.listeningFor),
    })
    // The same answer, reduced to what can be checked against a real job.
    // Only the blanks: anything the candidate typed in themselves stands.
    const preferences = applyExtractedPreferences(candidateId, data.preferences)

    return {
      id: row.id,
      rawAnswer: answerText,
      groups: data.groups,
      listeningFor: data.listeningFor,
      structured: true,
      preferences,
    }
  } catch {
    const row = insertIntent({
      id: newId('intn'),
      candidate_id: candidateId,
      raw_answer: answerText,
      groups: JSON.stringify([{ label: 'Other', values: [answerText.slice(0, 120)] }]),
      listening_for: JSON.stringify([]),
    })
    return {
      id: row.id,
      rawAnswer: answerText,
      groups: [{ label: 'In your words', values: [answerText] }],
      listeningFor: [],
      structured: false,
      preferences: readPreferences(candidateId),
    }
  }
}

export function readLatestIntent(candidateId: string): IntentRow | undefined {
  return getLatestIntent(candidateId)
}

export function confirmLatestIntent(intentId: string): void {
  confirmIntent(intentId)
}
