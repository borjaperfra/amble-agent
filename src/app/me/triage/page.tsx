import { requireCandidate } from '@/lib/auth/session'
import TriageFlow from '@/components/flows/TriageFlow'

export const dynamic = 'force-dynamic'

// Revealed intent (PRODUCT_SPEC §15.1).
export default async function TriagePage() {
  await requireCandidate()
  return <TriageFlow />
}
