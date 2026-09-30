import { getDb } from './db/db'
import { isSearchPaused, setSearchPaused } from './db/repo'
import { requestReread } from './matching/run'
import { dropPastReminders } from './whatsapp/reminders'

// A candidate can pause the search until further notice (they found a job,
// they need a break) and resume it. While paused nothing is read for them and
// amble writes nothing first: no offers, no questions, no reminders. The Rep
// still answers when they write.

export { isSearchPaused }

// `checkOn`: for a pause for a while, the day to ask whether to start again.
export function pauseSearch(candidateId: string, checkOn: string | null = null): boolean {
  const changed = setSearchPaused(candidateId, true)
  getDb().prepare('UPDATE candidates SET pause_check_on = ? WHERE id = ?').run(checkOn, candidateId)
  return changed
}

// Running again: what came in lately is read at once, not at the next pass,
// and a reminder whose day went by is not sent late.
export function resumeSearch(candidateId: string): boolean {
  const changed = setSearchPaused(candidateId, false)
  getDb().prepare('UPDATE candidates SET pause_check_on = NULL WHERE id = ?').run(candidateId)
  if (changed) {
    dropPastReminders(candidateId)
    requestReread(candidateId)
  }
  return changed
}
