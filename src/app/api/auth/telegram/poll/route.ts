import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { startSession } from '@/lib/auth/session'
import { getCandidate } from '@/lib/db/repo'
import { LOGIN_COOKIE, takeLogin } from '@/lib/telegram/login'

export const runtime = 'nodejs'

// The login page, while they confirm in Telegram: «in» once they did (this
// browser is signed in to the account of that chat), «pending» meanwhile,
// «gone» when there is nothing to wait for (no code, or it ran out).
export async function POST() {
  const store = await cookies()
  const secret = store.get(LOGIN_COOKIE)?.value
  if (!secret) return NextResponse.json({ status: 'gone' })
  const result = takeLogin(secret)
  if (result === 'pending') return NextResponse.json({ status: 'pending' })
  store.delete(LOGIN_COOKIE)
  if (result === 'gone' || !getCandidate(result.candidateId)) return NextResponse.json({ status: 'gone' })
  await startSession(result.candidateId)
  return NextResponse.json({ status: 'in' })
}
