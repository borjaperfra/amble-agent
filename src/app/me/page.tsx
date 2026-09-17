import { isUserZero } from '@/lib/features'
import { getMapViewModel } from '@/lib/view'
import FixtureMapFlow from '@/components/fixture/FixtureMapFlow'
import UserZeroMapView from '@/components/userzero/UserZeroMapView'

export const dynamic = 'force-dynamic'

export default function MapPage() {
  if (!isUserZero()) return <FixtureMapFlow />
  const vm = getMapViewModel()
  return <UserZeroMapView vm={vm} />
}
