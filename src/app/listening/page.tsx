import { isUserZero } from '@/lib/features'
import { getListeningViewModel } from '@/lib/view'
import FixtureListeningFlow from '@/components/fixture/FixtureListeningFlow'
import UserZeroListeningFlow from '@/components/userzero/UserZeroListeningFlow'

export const dynamic = 'force-dynamic'

export default function ListeningPage() {
  if (!isUserZero()) return <FixtureListeningFlow />
  const vm = getListeningViewModel()
  return <UserZeroListeningFlow vm={vm} />
}
