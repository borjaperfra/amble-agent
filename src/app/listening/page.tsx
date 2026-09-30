import { requireCandidate } from '@/lib/auth/session'
import { isRereading, startFirstRead } from '@/lib/matching/run'
import { isSearchPaused } from '@/lib/pause'
import { getListeningViewModel } from '@/lib/view'
import { linkOf } from '@/lib/whatsapp/link'
import { zernioConfig } from '@/lib/whatsapp/zernio'
import ListeningFlow from '@/components/flows/ListeningFlow'

export const dynamic = 'force-dynamic'

export default async function ListeningPage() {
  const candidate = await requireCandidate()
  // The first time they are here with something to listen for, the Rep starts
  // reading for them at once.
  const firstReading = startFirstRead(candidate.id)
  // Setting up ends by connecting WhatsApp: from then on the Rep writes there.
  const whatsapp = { available: zernioConfig() !== null, linked: linkOf(candidate.id) !== null }
  // Paused until they resume it; or reading again after a change to their rules.
  const paused = isSearchPaused(candidate.id)
  const rereading = !paused && isRereading(candidate.id)
  return <ListeningFlow vm={{ ...getListeningViewModel(candidate.id), firstReading, rereading, paused, whatsapp }} />
}
