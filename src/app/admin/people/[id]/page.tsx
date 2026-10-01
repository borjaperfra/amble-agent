import { notFound } from 'next/navigation'
import AdminPerson from '@/components/flows/AdminPerson'
import { isOwner } from '@/lib/auth/session'
import { listAdminFeedback } from '@/lib/admin/feedback-triage'
import { getDb } from '@/lib/db/db'
import { getCandidate } from '@/lib/db/repo'

export const dynamic = 'force-dynamic'

// One person, for the owner: who they are, how they came in and what they said.
export default async function AdminPersonPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) notFound()
  const { id } = await params
  const candidate = getCandidate(id)
  if (!candidate) notFound()
  const invite = candidate.email
    ? (getDb().prepare('SELECT created_at, sent_at FROM waitlist_invites WHERE email = ?').get(candidate.email.trim().toLowerCase()) as
        | { created_at: string; sent_at: string | null }
        | undefined)
    : undefined
  return (
    <AdminPerson
      person={{
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        role: candidate.role,
        locale: candidate.locale,
        created_at: candidate.created_at,
        setup_at: candidate.setup_at,
        invited_at: invite?.sent_at ?? invite?.created_at ?? null,
      }}
      feedback={listAdminFeedback(candidate.id)}
    />
  )
}
