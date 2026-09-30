import {
  confirmIntent,
  getLatestIntent,
  candidateById,
  insertIntent,
  newId,
  type IntentRow,
} from '../db/repo'
import { runInterpretIntentTask } from '../model/tasks'
import { serverText } from '../i18n/candidate'

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

export async function interpretIntent(candidateId: string, answerText: string): Promise<IntentResult> {
  const candidate = candidateById(candidateId)
  try {
    // A busy model is waited for, and asked again, where every call is (provider.ts).
    const { data } = await runInterpretIntentTask({ candidateId: candidate.id, answer: answerText })
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
    const row = insertIntent({
      id: newId('intn'),
      candidate_id: candidate.id,
      raw_answer: answerText,
      groups: JSON.stringify([{ label: serverText().inYourWords, values: [answerText.slice(0, 120)] }]),
      listening_for: JSON.stringify([]),
    })
    return {
      id: row.id,
      rawAnswer: answerText,
      groups: [{ label: serverText().inYourWords, values: [answerText] }],
      listeningFor: [],
      structured: false,
    }
  }
}

export function readLatestIntent(candidateId: string): IntentRow | undefined {
  return getLatestIntent(candidateId)
}

// False when the intent is not this candidate's.
export function confirmLatestIntent(candidateId: string, intentId: string, groups?: IntentGroups[]): boolean {
  return confirmIntent(candidateId, intentId, groups)
}
