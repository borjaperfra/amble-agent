import { isUserZero } from '@/lib/features'
import FixtureIntentFlow from '@/components/fixture/FixtureIntentFlow'
import UserZeroIntentFlow from '@/components/userzero/UserZeroIntentFlow'

export const dynamic = 'force-dynamic'

export default function IntentPage() {
  return isUserZero() ? <UserZeroIntentFlow /> : <FixtureIntentFlow />
}
