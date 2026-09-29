'use client'

import { useState } from 'react'
import Header from '@/components/Header'
import { useI18n } from '@/components/I18nProvider'
import { privacyUrl } from '@/lib/legal'
import styles from '@/app/me/data/data.module.css'

export default function DataFlow({ owner }: { owner: boolean }) {
  const { locale, t } = useI18n()
  const d = t.data
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'deleting' | 'deleted'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setError(null)
    setState('deleting')
    try {
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', email }),
      })
      if (response.ok) {
        setState('deleted')
        return
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(body?.error === 'email' ? d.wrongEmail : d.deleteFailed)
    } catch {
      setError(d.deleteFailed)
    }
    setState('idle')
  }

  if (state === 'deleted') {
    return (
      <>
        <Header />
        <main className={styles.page}>
          <h1 className={styles.title}>{d.deletedTitle}</h1>
          <p className={styles.lead}>{d.deletedLead}</p>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{d.title}</h1>
        <p className={styles.lead}>{d.lead}</p>
        <a className={styles.privacy} href={privacyUrl(locale)} target="_blank" rel="noreferrer">
          {d.privacy}
        </a>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{d.downloadTitle}</h2>
          <p className={styles.body}>{d.downloadBody}</p>
          <div className={styles.actions}>
            <a className="btn" href="/api/account" download>
              {d.download}
            </a>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{d.deleteTitle}</h2>
          <p className={styles.body}>{owner ? d.ownerCannot : d.deleteBody}</p>
          {!owner && (
            <form
              className={styles.actions}
              onSubmit={(event) => {
                event.preventDefault()
                void remove()
              }}
            >
              <input
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={d.emailPlaceholder}
                aria-label={d.emailLabel}
                required
              />
              <button type="submit" className="btn" disabled={state === 'deleting' || email.trim() === ''}>
                {state === 'deleting' ? d.deleting : d.delete}
              </button>
            </form>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    </>
  )
}
