import { getDb } from './db/db'
import { getLatestIntent, listConfirmedPreferences, listEvidence, listSources, listUnprocessedSources, type CandidateRow } from './db/repo'
import { setupProgress, startSetup } from './pipeline/setup'

// Where someone picks up after signing in: the next step of the setup they
// have not taken. The order: their name, what they share, what they are
// looking for (while what they shared is read), two questions about it, and
// then the Rep listens. Someone who already answered both is home.
export function nextStep(candidate: CandidateRow): string {
  const sources = listSources(candidate.id)
  if (!candidate.setup_at && sources.length === 0) return '/welcome'
  if (sources.length === 0) return '/onboarding'

  // Reading resumes on its own if it was cut short.
  const unread = listUnprocessedSources(candidate.id).length > 0
  if (unread) startSetup(candidate.id)

  const intentConfirmed = Boolean(getLatestIntent(candidate.id)?.confirmed_at) || listConfirmedPreferences(candidate.id).length > 0
  if (!intentConfirmed) return '/me/intent'

  const interviewDone = getDb().prepare("SELECT 1 FROM interviews WHERE candidate_id = ? AND status = 'completed'").get(candidate.id)
  // Still being read counts as something to ask about; every source
  // unreadable does not.
  const reading = unread || ['reading', 'weighing', 'questions'].includes(setupProgress(candidate.id)?.stage ?? '')
  if (!interviewDone && (reading || listEvidence(candidate.id).length > 0)) return '/onboarding/interview'
  // Nothing they shared could be used: back to sharing something else.
  if (listEvidence(candidate.id).length === 0) return '/onboarding'
  return '/listening'
}
