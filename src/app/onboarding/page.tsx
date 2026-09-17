import { isUserZero } from '@/lib/features'
import FixtureOnboardingFlow from '@/components/fixture/FixtureOnboardingFlow'
import UserZeroOnboardingFlow from '@/components/userzero/UserZeroOnboardingFlow'

export const dynamic = 'force-dynamic'

export default function OnboardingPage() {
  return isUserZero() ? <UserZeroOnboardingFlow /> : <FixtureOnboardingFlow />
}
