import { requireCandidate } from '@/lib/auth/session'
import { listSources } from '@/lib/db/repo'
import OnboardingFlow from '@/components/flows/OnboardingFlow'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const candidate = await requireCandidate()
  // What they already added is still here after a reload, or when they come
  // back to add something else: nothing to upload twice.
  const sources = listSources(candidate.id).map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    detail: source.status_detail,
  }))
  return <OnboardingFlow initialSources={sources} />
}
