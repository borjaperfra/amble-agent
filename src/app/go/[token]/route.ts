import { NextResponse } from 'next/server'
import { appBase, openAppLink } from '@/lib/auth/applinks'
import { currentCandidate, startSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

// A link from WhatsApp: into their own account, at the page it points to.
// Someone already signed in stays who they are: a forwarded link never
// switches an open session.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = openAppLink(token)
  if (!link) return NextResponse.redirect(`${appBase()}/login`)
  if (!(await currentCandidate())) await startSession(link.candidateId)
  return NextResponse.redirect(`${appBase()}${link.route}`)
}
