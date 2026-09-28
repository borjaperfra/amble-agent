import Link from 'next/link'
import { redirect } from 'next/navigation'
import Header from '@/components/Header'
import LoginFlow from '@/components/flows/LoginFlow'
import { betaIsFull, openInvitation } from '@/lib/auth/invitations'
import { currentCandidate } from '@/lib/auth/session'
import { serverDictionary } from '@/lib/i18n/server'
import styles from '../../login/login.module.css'

export const dynamic = 'force-dynamic'

// An invitation link. Whoever already has an account is simply at home.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (await currentCandidate()) redirect('/start')
  const t = (await serverDictionary()).login

  const invitation = openInvitation(token)
  const full = invitation !== null && betaIsFull()
  if (invitation && !full) return <LoginFlow next="/start" invitation={token} />

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{full ? t.betaFullTitle : t.invitationUsedTitle}</h1>
        <p className={styles.lead}>{full ? t.betaFullLead : t.invitationUsedLead}</p>
        <div className={styles.actions}>
          {full ? (
            <a href="https://amble.fyi" className="btn">
              {t.waitlist}
            </a>
          ) : (
            <Link href="/login" className="btn">
              {t.signInInstead}
            </Link>
          )}
        </div>
      </main>
    </>
  )
}
