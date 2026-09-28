import { redirect } from 'next/navigation'
import { requireCandidate } from '@/lib/auth/session'
import { nextStep } from '@/lib/journey'

export const dynamic = 'force-dynamic'

// Signing in and the landing's call to action lead here: it sends each person
// to the step they have not taken yet.
export default async function StartPage() {
  redirect(nextStep(await requireCandidate()))
}
