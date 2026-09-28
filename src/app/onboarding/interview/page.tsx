import { requireCandidate } from '@/lib/auth/session'
import InterviewFlow from '@/components/flows/InterviewFlow'

export const dynamic = 'force-dynamic'

export default async function InterviewPage() {
  await requireCandidate()
  return <InterviewFlow />
}
