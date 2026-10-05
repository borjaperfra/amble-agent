import { requireCandidate } from '@/lib/auth/session'
import { getRulesView } from '@/lib/pipeline/rules'
import PreferencesFlow from '@/components/flows/PreferencesFlow'

export const dynamic = 'force-dynamic'

// Every rule the Rep applies, in one place, to change one by one.
export default async function PreferencesPage() {
  const candidate = await requireCandidate()
  return <PreferencesFlow initial={getRulesView(candidate.id)} />
}
