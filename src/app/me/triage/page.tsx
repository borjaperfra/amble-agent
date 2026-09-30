import { requireCandidate } from '@/lib/auth/session'
import { getTriageView } from '@/lib/pipeline/triage'
import TriageFlow from '@/components/flows/TriageFlow'

export const dynamic = 'force-dynamic'

// Revealed intent (PRODUCT_SPEC §15.1). The latest triage is read here, so the
// page opens on it instead of asking for it once the browser has the code.
export default async function TriagePage() {
  const candidate = await requireCandidate()
  return <TriageFlow initial={getTriageView(candidate.id)} />
}
