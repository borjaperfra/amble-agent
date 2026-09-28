import OpportunitiesFlow from '@/components/flows/OpportunitiesFlow'
import { requireCandidate } from '@/lib/auth/session'
import { getOpportunitiesView } from '@/lib/matching/view'

export const dynamic = 'force-dynamic'

// PRODUCT_SPEC §17 and DESIGN_SYSTEM §24: what the Rep found, why, and what it
// set aside. The explanation is the product; there is no match score.
export default async function OpportunitiesPage() {
  const candidate = await requireCandidate()
  return <OpportunitiesFlow view={getOpportunitiesView(candidate.id)} />
}
