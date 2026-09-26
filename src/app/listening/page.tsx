import { getListeningViewModel } from '@/lib/view'
import ListeningFlow from '@/components/flows/ListeningFlow'

export const dynamic = 'force-dynamic'

export default function ListeningPage() {
  return <ListeningFlow vm={getListeningViewModel()} />
}
