import { after } from 'next/server'
import { requireCandidate } from '@/lib/auth/session'
import { buildCvReview, cvReviewState, markCvReviewOpened } from '@/lib/career/cv-review'
import CvReviewFlow from '@/components/flows/CvReviewFlow'

export const dynamic = 'force-dynamic'

// «Tu CV, mejor» (#55): what to change in their CV, from the offers that fit
// them and what amble knows they have done. Built in the background the first
// time (or with a newer CV); the page shows it is under way and updates itself.
export default async function CvPage() {
  const candidate = await requireCandidate()
  const { state, build } = cvReviewState(candidate.id)
  if (build) {
    after(() =>
      buildCvReview(candidate.id).catch((error) => console.error(`[cv-review] ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`)),
    )
  }
  if (state.kind === 'ready') markCvReviewOpened(candidate.id)
  return <CvReviewFlow state={state} updating={build || state.kind === 'building'} />
}
