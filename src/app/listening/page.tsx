import { requireCandidate } from '@/lib/auth/session'
import { getListeningViewModel } from '@/lib/view'
import ListeningFlow from '@/components/flows/ListeningFlow'

export const dynamic = 'force-dynamic'

export default async function ListeningPage() {
  const candidate = await requireCandidate()
  return <ListeningFlow vm={getListeningViewModel(candidate.id)} />
}
