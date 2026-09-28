import { getDb } from './db/db'
import { getLatestIntent, listConfirmedPreferences, listEvidence, listSources, listUnprocessedSources, type CandidateRow } from './db/repo'

// Where someone picks up after signing in: the next step of the journey
// (PRODUCT_SPEC §6) they have not taken. Someone the Rep already listens for
// is home, whatever step they skipped.
export function nextStep(candidate: CandidateRow): string {
  const sources = listSources(candidate.id)
  if (!candidate.setup_at && sources.length === 0) return '/welcome'

  const intentConfirmed = Boolean(getLatestIntent(candidate.id)?.confirmed_at)
  if (intentConfirmed || listConfirmedPreferences(candidate.id).length > 0) return '/listening'

  if (sources.length === 0) return '/onboarding'
  if (listUnprocessedSources(candidate.id).length > 0) return '/onboarding/processing'
  // Every source was unreadable: nothing to interview about yet.
  if (listEvidence(candidate.id).length === 0) return '/onboarding'

  const interviewDone = getDb()
    .prepare("SELECT 1 FROM interviews WHERE candidate_id = ? AND status = 'completed'")
    .get(candidate.id)
  if (!interviewDone) return '/onboarding/interview'
  return '/me/intent'
}
