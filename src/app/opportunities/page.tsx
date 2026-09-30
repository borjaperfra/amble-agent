import OpportunitiesFlow, { type Tab } from '@/components/flows/OpportunitiesFlow'
import { requireCandidate } from '@/lib/auth/session'
import { getOpportunitiesView } from '@/lib/matching/view'
import { isSearchPaused } from '@/lib/pause'

export const dynamic = 'force-dynamic'

// PRODUCT_SPEC §17 and DESIGN_SYSTEM §24: what the Rep found, why, and what it
// set aside. The explanation is the product; there is no match score.
const TABS: Tab[] = ['new', 'wanted', 'sent', 'aside']

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const candidate = await requireCandidate()
  const asked = (await searchParams).tab
  const tab = TABS.find((key) => key === asked) ?? null
  return <OpportunitiesFlow view={getOpportunitiesView(candidate.id)} tab={tab} paused={isSearchPaused(candidate.id)} />
}
