import { isUserZero } from '@/lib/features'
import { getListeningViewModel } from '@/lib/view'
import { getPendingInterruption } from '@/lib/opportunity-view'
import { openQuestionFor } from '@/lib/pipeline/opportunity-questions'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { listExceptions } from '@/lib/pipeline/exceptions'
import { readPreferences } from '@/lib/pipeline/preferences'
import { getOpportunity } from '@/lib/db/opportunities'
import FixtureListeningFlow from '@/components/fixture/FixtureListeningFlow'
import UserZeroListeningFlow from '@/components/userzero/UserZeroListeningFlow'

export const dynamic = 'force-dynamic'

export default function ListeningPage() {
  if (!isUserZero()) return <FixtureListeningFlow />
  const vm = getListeningViewModel()
  // Rendered here as well as polled, so someone who opens the app to a
  // notification lands on the thing itself rather than on six seconds of
  // "nothing worth bothering you with".
  const candidateId = getOrCreateCandidate().id
  const open = openQuestionFor(candidateId)
  const about = open ? getOpportunity(open.opportunity_id) : null

  return (
    <UserZeroListeningFlow
      vm={vm}
      interruption={getPendingInterruption()}
      exceptions={listExceptions(candidateId, readPreferences(candidateId).language === 'en' ? 'en' : 'es')}
      question={
        open
          ? {
              id: open.id,
              question: open.question,
              reason: open.reason,
              company: about?.company ?? null,
              role: about?.role ?? null,
            }
          : null
      }
    />
  )
}
