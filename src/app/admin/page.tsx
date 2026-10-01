import { notFound } from 'next/navigation'
import AdminFlow from '@/components/flows/AdminFlow'
import { isOwner } from '@/lib/auth/session'
import { loadAdminOverview } from '@/lib/admin/overview'

export const dynamic = 'force-dynamic'

// The owner's admin: the site's waitlist, who was let in, and feedback by
// importance. For anyone else, signed in or not, there is nothing here.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!(await isOwner())) notFound()
  const { tab } = await searchParams
  return <AdminFlow initial={await loadAdminOverview()} initialTab={tab === 'feedback' ? 'feedback' : 'waitlist'} />
}
