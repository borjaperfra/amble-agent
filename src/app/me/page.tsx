import { getMapViewModel } from '@/lib/view'
import UserZeroMapView from '@/components/userzero/UserZeroMapView'

export const dynamic = 'force-dynamic'

export default function MapPage() {
  return <UserZeroMapView vm={getMapViewModel()} />
}
