import { isUserZero } from '@/lib/features'
import FixtureInterviewFlow from '@/components/fixture/FixtureInterviewFlow'
import UserZeroInterviewFlow from '@/components/userzero/UserZeroInterviewFlow'

export const dynamic = 'force-dynamic'

export default function InterviewPage() {
  return isUserZero() ? <UserZeroInterviewFlow /> : <FixtureInterviewFlow />
}
