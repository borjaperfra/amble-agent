import { redirect } from 'next/navigation'
import LoginFlow from '@/components/flows/LoginFlow'
import { currentCandidate } from '@/lib/auth/session'
import { safeNext } from './safe-next'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next)
  if (await currentCandidate()) redirect(next)
  return <LoginFlow next={next} />
}
