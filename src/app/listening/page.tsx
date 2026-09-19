import { isUserZero } from '@/lib/features'
import { getListeningViewModel } from '@/lib/view'
import { getPendingInterruption } from '@/lib/opportunity-view'
import FixtureListeningFlow from '@/components/fixture/FixtureListeningFlow'
import UserZeroListeningFlow from '@/components/userzero/UserZeroListeningFlow'

export const dynamic = 'force-dynamic'

export default function ListeningPage() {
  if (!isUserZero()) return <FixtureListeningFlow />
  const vm = getListeningViewModel()
  // Rendered here as well as polled, so someone who opens the app to a
  // notification lands on the thing itself rather than on six seconds of
  // "nothing worth bothering you with".
  return <UserZeroListeningFlow vm={vm} interruption={getPendingInterruption()} />
}
