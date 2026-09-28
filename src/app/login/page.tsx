import { redirect } from 'next/navigation'
import LoginFlow from '@/components/flows/LoginFlow'
import { currentCandidate } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

// Only a path inside the product: never another site.
function safeNext(value: string | string[] | undefined): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/listening'
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next)
  if (await currentCandidate()) redirect(next)
  return <LoginFlow next={next} />
}
