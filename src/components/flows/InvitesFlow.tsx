'use client'

import { useState, useSyncExternalStore } from 'react'
import Header from '@/components/Header'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/invites/invites.module.css'

interface Invite {
  id: string
  link: string
  accepted: boolean
}

// Each invitation by its number and whether it was used: the link itself is
// never on screen, only shared or copied, whole, by a button.
const noChange = () => () => {}

export default function InvitesFlow({ invites }: { invites: Invite[] }) {
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)
  // A phone shares through its own sheet (WhatsApp, Messages...); a desktop
  // copies. Known only in the browser: the server renders without it.
  const canShare = useSyncExternalStore(
    noChange,
    () => typeof navigator.share === 'function',
    () => false,
  )

  async function copy(invite: Invite) {
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied(invite.id)
    } catch {
      // Clipboard unavailable: sharing is the other way.
    }
  }

  async function share(invite: Invite) {
    try {
      await navigator.share({ text: t.invites.shareText, url: invite.link })
    } catch {
      // Closed without sharing: nothing to say.
    }
  }

  const left = invites.filter((invite) => !invite.accepted).length

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{t.invites.title}</h1>
        <p className={styles.lead}>{t.invites.lead(left)}</p>
        <ul className={styles.list}>
          {invites.map((invite, index) => (
            <li key={invite.id} className={invite.accepted ? `${styles.row} ${styles.used}` : styles.row}>
              <span className={styles.name}>{t.invites.item(index + 1)}</span>
              {invite.accepted ? (
                <span className={styles.state} aria-disabled="true">
                  <span className={styles.tick} aria-hidden="true">
                    ✓
                  </span>
                  {t.invites.accepted}
                </span>
              ) : (
                <span className={styles.actions}>
                  {canShare && (
                    <button type="button" className="btn" onClick={() => void share(invite)}>
                      {t.invites.share}
                    </button>
                  )}
                  <button type="button" className="btn btn-quiet" onClick={() => void copy(invite)}>
                    {copied === invite.id ? t.invites.copied : t.invites.copy}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
