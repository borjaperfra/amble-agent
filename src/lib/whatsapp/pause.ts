import { candidateById, newId } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { isSearchPaused, pauseSearch, resumeSearch } from '../pause'
import { awaitingOf, setAwaiting } from './offers'

// Pausing the search on WhatsApp, or resuming it: the agent proposes it when
// they say so, and only a yes on its buttons does it. Each proposal has its
// own buttons, as a change to their rules does.

const HOURS_TO_ANSWER = 24

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

export function proposePause(candidateId: string, pause: boolean): { title: string; payload: string }[] {
  const id = newId('pau').slice(4, 12)
  setAwaiting(candidateId, { kind: 'pause', id, pause, until: new Date(Date.now() + HOURS_TO_ANSWER * 60 * 60 * 1000).toISOString() })
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const labels = pause ? w.pauseButtons : w.resumeButtons
  return [
    { title: labels.yes, payload: `ps:${id}:yes` },
    { title: labels.no, payload: `ps:${id}:no` },
  ]
}

export interface PauseTap {
  id: string
  answer: 'yes' | 'no'
}

export function parsePausePayload(value: string | null): PauseTap | null {
  const match = value?.match(/^ps:(\w+):(yes|no)$/)
  return match ? { id: match[1], answer: match[2] as 'yes' | 'no' } : null
}

export async function answerPause(candidateId: string, tap: PauseTap, reply: Reply): Promise<void> {
  const w = dictionaries[candidateLocale(candidateById(candidateId))].whatsapp
  const awaiting = awaitingOf(candidateId)
  if (awaiting?.kind !== 'pause' || awaiting.id !== tap.id) {
    await reply(isSearchPaused(candidateId) ? w.pauseExpiredPaused : w.pauseExpiredRunning)
    return
  }
  setAwaiting(candidateId, null)
  if (tap.answer === 'no') {
    await reply(awaiting.pause ? w.pauseKept : w.resumeKept)
    return
  }
  if (awaiting.pause) pauseSearch(candidateId)
  else resumeSearch(candidateId)
  await reply(awaiting.pause ? w.paused : w.resumed)
}
