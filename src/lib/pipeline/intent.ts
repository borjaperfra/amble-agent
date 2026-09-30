import {
  confirmIntent,
  getLatestIntent,
  candidateById,
  insertIntent,
  newId,
  type IntentRow,
} from '../db/repo'
import { ModelError } from '../model/provider'
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

// The model busy for a moment (rate limited, overloaded): asked once more
// after a pause, while the page says it is reading, before settling for
// their words as they are.
const BUSY = new Set([429, 502, 503])
const BUSY_PAUSE_MS = 4_000

async function interpretWhenFree(candidateId: string, answer: string) {
  try {
    return await runInterpretIntentTask({ candidateId, answer })
  } catch (error) {
    if (!(error instanceof ModelError) || !BUSY.has(error.status ?? 0)) throw error
    await new Promise((resolve) => setTimeout(resolve, BUSY_PAUSE_MS))
    return runInterpretIntentTask({ candidateId, answer })
  }
}

export async function interpretIntent(candidateId: string, answerText: string): Promise<IntentResult> {
  const candidate = candidateById(candidateId)
  try {
    const { data } = await interpretWhenFree(candidate.id, answerText)
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
