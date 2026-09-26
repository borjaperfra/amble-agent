import { getMapViewModel } from '@/lib/view'
import MapView from '@/components/flows/MapView'

export const dynamic = 'force-dynamic'

export default function MapPage() {
  return <MapView vm={getMapViewModel()} />
}
