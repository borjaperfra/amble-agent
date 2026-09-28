'use client'

import { useState } from 'react'
import Header from '@/components/Header'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/invites/invites.module.css'

interface Invite {
  id: string
  link: string
  accepted: boolean
}

export default function InvitesFlow({ invites }: { invites: Invite[] }) {
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(invite: Invite) {
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied(invite.id)
    } catch {
      // Clipboard unavailable: the link is on screen to select by hand.
    }
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{t.invites.title}</h1>
        <p className={styles.lead}>{t.invites.lead(invites.length)}</p>
        <ul className={styles.list}>
          {invites.map((invite) => (
            <li key={invite.id} className={styles.row}>
              <span className={invite.accepted ? `${styles.link} ${styles.used}` : styles.link}>{invite.link}</span>
              {invite.accepted ? (
                <span className={styles.state}>{t.invites.accepted}</span>
              ) : (
                <button type="button" className="text-btn" onClick={() => void copy(invite)}>
                  {copied === invite.id ? t.invites.copied : t.invites.copy}
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
