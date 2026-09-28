'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useI18n } from './I18nProvider'
import Symbol from './Symbol'
import styles from './Header.module.css'

const navRoutes = ['/me', '/me/intent', '/listening', '/opportunities', '/invites']

interface HeaderProps {
  right?: React.ReactNode
}

export default function Header({ right }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { locale, t } = useI18n()
  const [switching, setSwitching] = useState(false)
  const showNav = navRoutes.includes(pathname)

  const navItems = [
    { href: '/listening', label: t.header.rep },
    { href: '/me', label: t.header.map },
    { href: '/me/intent', label: t.header.listeningFor },
    { href: '/opportunities', label: t.opportunities.nav },
    { href: '/invites', label: t.invites.nav },
  ]

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    router.replace('/login')
    router.refresh()
  }

  async function switchLanguage() {
    setSwitching(true)
    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: locale === 'es' ? 'en' : 'es' }),
      })
      router.refresh()
    } finally {
      setSwitching(false)
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark} aria-label="Amble">
          <Symbol size={26} />
          <span className={styles.word} aria-hidden="true">
            amble
          </span>
        </Link>
        {showNav && (
          <nav className={styles.nav} aria-label={t.header.nav}>
            {navItems.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}
        <div className={styles.right}>
          {right}
          {showNav && (
            <button type="button" className={styles.language} onClick={() => void signOut()}>
              {t.login.signOut}
            </button>
          )}
          <button
            type="button"
            className={styles.language}
            onClick={() => void switchLanguage()}
            disabled={switching}
            aria-label={t.header.switchToLabel}
            lang={locale === 'es' ? 'en' : 'es'}
          >
            {t.header.switchTo}
          </button>
        </div>
      </div>
    </header>
  )
}
