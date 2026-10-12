import { templatesEnabled } from './templates'
import { reachOf } from '../channel/reach'
import { candidateById, newId } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { getDb } from '../db/db'
import { isSearchPaused, pauseSearch, resumeSearch } from '../pause'
import { logMessage } from './conversation'
import { awaitingOf, setAwaiting } from './offers'

// Pausing the search on WhatsApp, or resuming it: the agent proposes it when
// they say so, and only a yes on its buttons does it. Each proposal has its
// own buttons, as a change to their rules does.

const HOURS_TO_ANSWER = 24

type Reply = (text: string, buttons?: { title: string; payload: string }[]) => Promise<unknown>

// `checkIn`: for a pause for a while, the day to ask whether to start again.
export function proposePause(candidateId: string, pause: boolean, checkIn: string | null = null): { title: string; payload: string }[] {
  const id = newId('pau').slice(4, 12)
  setAwaiting(candidateId, { kind: 'pause', id, pause, checkIn, until: new Date(Date.now() + HOURS_TO_ANSWER * 60 * 60 * 1000).toISOString() })
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
  if (awaiting.pause) pauseSearch(candidateId, awaiting.checkIn ?? null)
  else resumeSearch(candidateId)
  await reply(awaiting.pause ? (awaiting.checkIn ? w.pausedUntil(awaiting.checkIn) : w.paused) : w.resumed)
}

// A pause for a while, over: asked once whether to start again, with the
// buttons to do it. Whatever they answer, it is not asked again.
export async function sendPauseCheckIns(): Promise<{ asked: number; skipped: number }> {
  const stats = { asked: 0, skipped: 0 }
  const due = getDb()
    .prepare('SELECT id, pause_check_on FROM candidates WHERE search_paused_at IS NOT NULL AND pause_check_on IS NOT NULL AND pause_check_on <= ?')
    .all(new Date().toISOString().slice(0, 10)) as { id: string; pause_check_on: string }[]
  for (const { id, pause_check_on: checkOn } of due) {
    const reach = reachOf(id)
    const open = reach?.open ?? false
    getDb().prepare('UPDATE candidates SET pause_check_on = NULL WHERE id = ?').run(id)
    if (!reach || (!open && reach.sandbox)) {
      stats.skipped++
      continue
    }
    const text = dictionaries[candidateLocale(candidateById(id))].whatsapp.pauseCheckIn
    try {
      if (!open && templatesEnabled()) {
        const locale = candidateLocale(candidateById(id))
        const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(`${checkOn}T12:00:00Z`))
        const buttons = proposePause(id, false)
        await reach.template('pause', [date], buttons.map((button) => button.payload), `tpl-pause:${id}:${checkOn}`)
        stats.asked++
        continue
      }
      await reach.send({ text, buttons: proposePause(id, false), utility: !open, quiet: true, idempotencyKey: `pausecheck:${id}:${new Date().toISOString().slice(0, 10)}` })
      logMessage(id, 'out', text)
      stats.asked++
    } catch {
      stats.skipped++
    }
  }
  return stats
}
