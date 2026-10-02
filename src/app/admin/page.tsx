import { notFound } from 'next/navigation'
import AdminFlow from '@/components/flows/AdminFlow'
import { isOwner } from '@/lib/auth/session'
import { loadAdminOverview } from '@/lib/admin/overview'

export const dynamic = 'force-dynamic'

// The owner's admin: the site's waitlist, who was let in, feedback by
// importance and how amble is doing. For anyone else, signed in or not,
// there is nothing here.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!(await isOwner())) notFound()
  const { tab } = await searchParams
  const initialTab = tab === 'feedback' || tab === 'health' ? tab : 'waitlist'
  return <AdminFlow initial={await loadAdminOverview()} initialTab={initialTab} />
}
