import { requireCandidate } from '@/lib/auth/session'
import OnboardingFlow from '@/components/flows/OnboardingFlow'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  await requireCandidate()
  return <OnboardingFlow />
}
