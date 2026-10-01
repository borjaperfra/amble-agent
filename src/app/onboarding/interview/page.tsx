import { requireCandidate } from '@/lib/auth/session'
import { getInterviewState, SETUP_QUESTIONS } from '@/lib/pipeline/interview'
import InterviewFlow from '@/components/flows/InterviewFlow'

export const dynamic = 'force-dynamic'

export default async function InterviewPage() {
  const candidate = await requireCandidate()
  const answered = getInterviewState(candidate.id).turns.filter((turn) => turn.answer !== null).length
  // What they are looking for is step one; the two questions follow. Past
  // the setup (answering what is still unknown, from the map) there are no steps.
  const steps = answered >= SETUP_QUESTIONS ? 0 : SETUP_QUESTIONS + 1
  return <InterviewFlow owner={candidate.role === 'owner'} step={Math.min(answered + 2, SETUP_QUESTIONS + 1)} steps={steps} />
}
