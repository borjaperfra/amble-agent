import { notFound } from 'next/navigation'
import { isUserZero } from '@/lib/features'
import UserZeroTriageFlow from '@/components/userzero/UserZeroTriageFlow'

export const dynamic = 'force-dynamic'

// Revealed intent (PRODUCT_SPEC §15.1). There is no fixture version: a triage
// only means something with a real person's answers.
export default function TriagePage() {
  if (!isUserZero()) notFound()
  return <UserZeroTriageFlow />
}
