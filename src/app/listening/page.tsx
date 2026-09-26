import { getListeningViewModel } from '@/lib/view'
import UserZeroListeningFlow from '@/components/userzero/UserZeroListeningFlow'

export const dynamic = 'force-dynamic'

export default function ListeningPage() {
  return <UserZeroListeningFlow vm={getListeningViewModel()} />
}
