import { notFound } from 'next/navigation'
import FeedbackList from '@/components/flows/FeedbackList'
import { isOwner, requireCandidate } from '@/lib/auth/session'
import { listFeedback } from '@/lib/feedback'

export const dynamic = 'force-dynamic'

// What beta users have said, for the owner: unread first.
export default async function FeedbackPage() {
  await requireCandidate()
  if (!(await isOwner())) notFound()
  return <FeedbackList items={listFeedback()} />
}
