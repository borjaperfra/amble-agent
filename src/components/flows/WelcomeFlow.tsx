'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import type { Locale } from '@/lib/i18n/locale'
import styles from '@/app/login/login.module.css'

// Each language named in itself: someone who cannot read the other one still
// finds theirs.
const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: 'es', name: 'Castellano' },
  { locale: 'en', name: 'English' },
]

export default function WelcomeFlow({ name: initialName, locale: initialLocale }: { name: string; locale: Locale }) {
  const router = useRouter()
  const t = useT()
  const [name, setName] = useState(initialName)
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, locale }),
      })
      if (!response.ok) throw new Error()
      router.push('/onboarding')
      router.refresh()
    } catch {
      setBusy(false)
      setFailed(true)
    }
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <div className={styles.stage}>
          <Symbol size={72} watch className={styles.eye} label={t.common.yourRep} />
          <h1 className={styles.title}>{t.welcome.title}</h1>
          <p className={styles.lead}>{t.welcome.lead}</p>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label className={styles.label} htmlFor="welcome-name">
              {t.welcome.nameLabel}
            </label>
            <input
              id="welcome-name"
              className={styles.input}
              autoComplete="given-name"
              maxLength={80}
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            <fieldset className={styles.choices}>
              <legend className={styles.label}>{t.welcome.languageLabel}</legend>
              {LANGUAGES.map((language) => (
                <label key={language.locale} className={styles.choice} data-selected={locale === language.locale} lang={language.locale}>
                  <input
                    type="radio"
                    name="language"
                    className="visually-hidden"
                    checked={locale === language.locale}
                    onChange={() => setLocale(language.locale)}
                  />
                  {language.name}
                </label>
              ))}
            </fieldset>

            {failed && (
              <p className={styles.error} role="alert">
                {t.welcome.failed}
              </p>
            )}
            <button type="submit" className={`btn ${styles.submit}`} disabled={busy || !name.trim()}>
              {busy ? t.welcome.saving : t.welcome.continue}
            </button>
          </form>
        </div>
      </main>
    </>
  )
}
