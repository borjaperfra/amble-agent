import { getMapViewModel } from '@/lib/view'
import { serverLocale } from '@/lib/i18n/server'
import MapView from '@/components/flows/MapView'

export const dynamic = 'force-dynamic'

export default async function MapPage() {
  return <MapView vm={getMapViewModel(await serverLocale())} />
}
