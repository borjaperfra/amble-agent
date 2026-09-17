import { isUserZero } from '@/lib/features'
import FixtureProcessingFlow from '@/components/fixture/FixtureProcessingFlow'
import UserZeroProcessingFlow from '@/components/userzero/UserZeroProcessingFlow'

export const dynamic = 'force-dynamic'

export default function ProcessingPage() {
  return isUserZero() ? <UserZeroProcessingFlow /> : <FixtureProcessingFlow />
}
