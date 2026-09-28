import { redirect } from 'next/navigation'
import LinkFlow from '@/components/flows/LinkFlow'
import { peekLoginLink } from '@/lib/auth/codes'
import { currentCandidate } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// Where the link in the sign-in email lands. It signs in only when the person
// presses the button: opening the page spends nothing.
export default async function LoginLinkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await currentCandidate()) redirect('/start')
  const raw = (await searchParams).token
  const token = typeof raw === 'string' ? raw : ''
  return <LinkFlow token={token} email={token ? peekLoginLink(token) : null} />
}
