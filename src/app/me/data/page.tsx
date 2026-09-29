import DataFlow from '@/components/flows/DataFlow'
import { requireCandidate } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// What amble keeps about them is theirs: a copy to take, and a way to delete
// the account and everything in it.
export default async function DataPage() {
  const candidate = await requireCandidate()
  return <DataFlow owner={candidate.role === 'owner'} />
}
