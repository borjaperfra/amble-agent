import { followupDueToday } from './followups'
import { reminderDueToday } from './reminders'
import { weeklyDueToday } from './weekly'

// amble writes first once a day at most (proactive.ts), and what goes was
// whatever was ready first: the day's offers go from 09:00, after the
// morning pass, and so the 11:00 round (a follow-up on an application, a
// reminder they asked for) seldom found the day free. What matters more
// goes first: a reminder they asked for, a follow-up on an application,
// Monday's summary of their week; on such a day the offers wait for the
// next. After those, in the 11:00 round's order: the offers' list or the
// note on why the chat is quiet, a rule waiting for their yes, an offer
// they liked and have not sent, a question for their map, the pause.
export function moreImportantToday(candidateId: string): string | null {
  if (reminderDueToday(candidateId)) return 'reminder'
  if (followupDueToday(candidateId)) return 'followup'
  if (weeklyDueToday(candidateId)) return 'weekly'
  return null
}
