import { redirect } from 'next/navigation'
import WelcomeFlow from '@/components/flows/WelcomeFlow'
import { requireCandidate } from '@/lib/auth/session'
import { listSources } from '@/lib/db/repo'
import { serverLocale } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// The first time in: the name the Rep will use, and the language. Once, and
// only for someone who has not started yet.
export default async function WelcomePage() {
  const candidate = await requireCandidate()
  if (candidate.setup_at || listSources(candidate.id).length > 0) redirect('/start')
  return <WelcomeFlow name={candidate.name ?? ''} locale={await serverLocale()} />
}
