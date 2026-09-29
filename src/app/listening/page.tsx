import { requireCandidate } from '@/lib/auth/session'
import { startFirstRead } from '@/lib/matching/run'
import { getListeningViewModel } from '@/lib/view'
import ListeningFlow from '@/components/flows/ListeningFlow'

export const dynamic = 'force-dynamic'

export default async function ListeningPage() {
  const candidate = await requireCandidate()
  // The first time they are here with something to listen for, the Rep starts
  // reading for them at once.
  const firstReading = startFirstRead(candidate.id)
  return <ListeningFlow vm={{ ...getListeningViewModel(candidate.id), firstReading }} />
}
