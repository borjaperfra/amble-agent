import { requireCandidate } from '@/lib/auth/session'
import IntentFlow from '@/components/flows/IntentFlow'
import { getCurrentIntent, listConfirmedPreferences } from '@/lib/db/repo'
import { SETUP_QUESTIONS } from '@/lib/pipeline/interview'

export const dynamic = 'force-dynamic'

export default async function IntentPage() {
  const candidate = await requireCandidate()
  // During the setup, what they are looking for is step one of three.
  const setup = !getCurrentIntent(candidate.id) && listConfirmedPreferences(candidate.id).length === 0
  return <IntentFlow setupStep={setup ? { current: 1, total: SETUP_QUESTIONS + 1 } : null} updating={Boolean(getCurrentIntent(candidate.id))} />
}
