import InvitesFlow from '@/components/flows/InvitesFlow'
import { invitationLink, invitationsOf } from '@/lib/auth/invitations'
import { requireCandidate } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// The candidate's invitations. Who accepted one is not shown: an invitation is
// a way in, not a way to follow someone.
export default async function InvitesPage() {
  const candidate = await requireCandidate()
  const invites = invitationsOf(candidate.id).map((invitation) => ({
    id: invitation.id,
    link: invitationLink(invitation.token),
    accepted: invitation.accepted_at !== null,
  }))
  return <InvitesFlow invites={invites} />
}
