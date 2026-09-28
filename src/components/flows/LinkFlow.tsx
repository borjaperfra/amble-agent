'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/login/login.module.css'

const GREET_MS = 1100
const LEAVE_MS = 620
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

// The address, marked where the sentence names it.
function withEmail(sentence: string, email: string) {
  const at = email ? sentence.indexOf(email) : -1
  if (at < 0) return sentence
  return (
    <>
      {sentence.slice(0, at)}
      <span className={styles.email}>{email}</span>
      {sentence.slice(at + email.length)}
    </>
  )
}

// The one-click way in: the same goodbye as the code, the eye closing here to
// wake on the next page.
export default function LinkFlow({ token, email }: { token: string; email: string | null }) {
  const router = useRouter()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(email === null)
  const [greeting, setGreeting] = useState<string | null>(null)
  const [lid, setLid] = useState(0)
  const [leaving, setLeaving] = useState(false)

  async function signIn() {
    setBusy(true)
    try {
      const response = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = (await response.json().catch(() => ({}))) as { name?: unknown; joined?: unknown }
      if (!response.ok) throw new Error()
      const first = typeof data.name === 'string' ? data.name.trim().split(/\s+/)[0] : ''
      if (first && data.joined !== true) {
        setGreeting(t.login.welcomeBack(first))
        await wait(GREET_MS)
      }
      setLid(1)
      setLeaving(true)
      await wait(LEAVE_MS)
      router.replace('/start')
      router.refresh()
    } catch {
      setBusy(false)
      setExpired(true)
    }
  }

  return (
    <>
      <Header />
      <main className={leaving ? `${styles.page} ${styles.leaving}` : styles.page}>
        <div className={styles.stage}>
          <Symbol size={72} watch lid={expired ? 0.55 : lid} className={styles.eye} />
          {expired ? (
            <div className={`${styles.step} ${styles.enter}`} key="expired">
              <h1 className={styles.title}>{t.login.linkExpiredTitle}</h1>
              <p className={styles.lead}>{t.login.linkExpiredLead}</p>
              <div className={styles.actions}>
                <Link href="/login" className="btn">
                  {t.login.linkBack}
                </Link>
              </div>
            </div>
          ) : (
            <div className={styles.step} key="link">
              <h1 className={styles.title} key={greeting ?? 'link'}>
                {greeting ?? t.login.linkTitle}
              </h1>
              <p className={styles.lead}>{withEmail(t.login.linkLead(email ?? ''), email ?? '')}</p>
              <div className={styles.actions}>
                <button type="button" className="btn" disabled={busy} onClick={() => void signIn()}>
                  <span className={busy ? `${styles.buttonText} ${styles.tracing}` : styles.buttonText}>{t.login.linkButton}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
