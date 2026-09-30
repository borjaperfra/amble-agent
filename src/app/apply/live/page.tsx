import { requireCandidate } from '@/lib/auth/session'
import { getDb } from '@/lib/db/db'
import LivePage from '@/components/flows/LivePage'

export const dynamic = 'force-dynamic'

// Where a link from WhatsApp lands: the form amble filled for them, open in a
// browser in the cloud, to check, finish and send. Only for the signed-in
// candidate: the live view itself is never in the link.
export default async function ApplyLivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCandidate()
  const asked = (await searchParams).o
  const opportunityId = typeof asked === 'string' ? asked.replace(/[^A-Za-z0-9_-]/g, '') : ''
  const offer = getDb().prepare('SELECT o.title, c.name AS company FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.id = ?').get(opportunityId) as
    | { title: string; company: string }
    | undefined
  return <LivePage opportunityId={opportunityId} company={offer?.company ?? ''} title={offer?.title ?? ''} />
}
