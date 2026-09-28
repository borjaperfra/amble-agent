import { requireCandidate } from '@/lib/auth/session'
import ProcessingFlow from '@/components/flows/ProcessingFlow'

export const dynamic = 'force-dynamic'

export default async function ProcessingPage() {
  await requireCandidate()
  return <ProcessingFlow />
}
