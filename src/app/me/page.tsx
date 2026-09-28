import { requireCandidate } from '@/lib/auth/session'
import { getMapViewModel } from '@/lib/view'
import { serverLocale } from '@/lib/i18n/server'
import MapView from '@/components/flows/MapView'

export const dynamic = 'force-dynamic'

export default async function MapPage() {
  const candidate = await requireCandidate()
  return <MapView vm={getMapViewModel(candidate.id, await serverLocale())} />
}
