import { listAdminFeedback, triageAvailable, untriagedCount, type AdminFeedbackItem } from './feedback-triage'
import { adminWaitlist, betaSeats, type AdminWaitlistEntry, type BetaSeats } from './invites'
import { waitlistConnected } from './waitlist'

// Everything the admin shows at once: the waitlist with who was let in, the
// beta's seats, and the feedback by importance.

export interface AdminWaitlistState {
  // 'off': no database set; 'error': set, but it did not answer.
  connection: 'ok' | 'off' | 'error'
  entries: AdminWaitlistEntry[]
}

export interface AdminOverview {
  waitlist: AdminWaitlistState
  seats: BetaSeats
  feedback: AdminFeedbackItem[]
  untriaged: number
  triageAvailable: boolean
}

export async function loadWaitlistState(): Promise<AdminWaitlistState> {
  if (!waitlistConnected()) return { connection: 'off', entries: [] }
  try {
    return { connection: 'ok', entries: await adminWaitlist() }
  } catch (error) {
    console.error('[amble] waitlist not read:', error instanceof Error ? error.message : error)
    return { connection: 'error', entries: [] }
  }
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  return {
    waitlist: await loadWaitlistState(),
    seats: betaSeats(),
    feedback: listAdminFeedback(),
    untriaged: untriagedCount(),
    triageAvailable: triageAvailable(),
  }
}
