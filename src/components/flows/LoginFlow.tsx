'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/login/login.module.css'

type Phase = 'email' | 'code'
type ErrorKey = 'invalidEmail' | 'tooMany' | 'failed' | 'wrongCode' | 'expiredCode' | 'invitationUsed' | 'betaFull'

// What the auth routes answer, as the screen says it.
const ERRORS: Record<string, ErrorKey> = {
  invalid_email: 'invalidEmail',
  too_many: 'tooMany',
  failed: 'failed',
  wrong: 'wrongCode',
  expired: 'expiredCode',
  invitation_used: 'invitationUsed',
  beta_full: 'betaFull',
}

// Signing in, or, with an invitation, creating an account: the same two
// steps, email then code.
export default function LoginFlow({ next, invitation = null }: { next: string; invitation?: string | null }) {
  const router = useRouter()
  const t = useT()
  const [phase, setPhase] = useState<Phase>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorKey | null>(null)

  async function post(path: string, body: unknown): Promise<string | null> {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.ok) return null
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      return data.error ?? 'failed'
    } catch {
      return 'failed'
    }
  }

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    const failure = await post('/api/auth/code', invitation ? { email, invitation } : { email })
    setBusy(false)
    if (failure) {
      setError(ERRORS[failure] ?? 'failed')
      return
    }
    setCode('')
    setPhase('code')
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const failure = await post('/api/auth/verify', { email, code })
    if (failure) {
      setBusy(false)
      setError(ERRORS[failure] ?? 'wrongCode')
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <p className="kicker rep-kicker">
          <Symbol size={20} /> Amble
        </p>

        {phase === 'email' ? (
          <>
            <h1 className={styles.title}>{invitation ? t.login.joinTitle : t.login.title}</h1>
            <p className={styles.lead}>{invitation ? t.login.joinLead : t.login.lead}</p>
            <form className={styles.form} onSubmit={(event) => void sendCode(event)}>
              <label className={styles.label} htmlFor="login-email">
                {t.login.emailLabel}
              </label>
              <input
                id="login-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {error && (
                <p className={styles.error} role="alert">
                  {t.login[error]}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className="btn" disabled={busy || !email.trim()}>
                  {busy ? t.login.sending : t.login.send}
                </button>
              </div>
            </form>
            {!invitation && (
              <p className={styles.beta}>
                {t.login.noAccount} <a href="https://amble.fyi">{t.login.waitlist}</a>
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className={styles.title}>{t.login.codeTitle}</h1>
            <p className={styles.lead}>{t.login.codeLead(email.trim())}</p>
            <form className={styles.form} onSubmit={(event) => void verify(event)}>
              <label className={styles.label} htmlFor="login-code">
                {t.login.codeLabel}
              </label>
              <input
                id="login-code"
                className={`${styles.input} ${styles.code}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
              {error && (
                <p className={styles.error} role="alert">
                  {t.login[error]}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className="btn" disabled={busy || code.length !== 6}>
                  {busy ? t.login.verifying : t.login.verify}
                </button>
                <button type="button" className="text-btn" disabled={busy} onClick={() => void sendCode()}>
                  {t.login.resend}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={busy}
                  onClick={() => {
                    setPhase('email')
                    setError(null)
                  }}
                >
                  {t.login.otherEmail}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </>
  )
}
