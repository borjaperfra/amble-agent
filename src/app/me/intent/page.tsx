import { requireCandidate } from '@/lib/auth/session'
import IntentFlow from '@/components/flows/IntentFlow'

export const dynamic = 'force-dynamic'

export default async function IntentPage() {
  await requireCandidate()
  return <IntentFlow />
}
