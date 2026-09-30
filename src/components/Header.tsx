'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useI18n } from './I18nProvider'
import { postJson } from './api'
import { OPEN_FEEDBACK } from './FeedbackButton'
import Symbol from './Symbol'
import styles from './Header.module.css'

const navRoutes = ['/me', '/me/intent', '/me/data', '/me/triage', '/listening', '/opportunities', '/invites']

interface HeaderProps {
  right?: React.ReactNode
  // A page that asks for the language itself (/welcome) has no second switch.
  language?: boolean
  // A step of the setup keeps to itself: no sections to wander off to.
  nav?: boolean
}

// On a wide screen, the sections in a row; on a phone, behind a menu button,
// so nothing wraps or pushes the page sideways. What a page puts on the right
// (Save and leave) always stays in the bar.
export default function Header({ right, language = true, nav = true }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { locale, t } = useI18n()
  const [switching, setSwitching] = useState(false)
  const [open, setOpen] = useState(false)
  const showNav = nav && navRoutes.includes(pathname)

  const navItems = [
    { href: '/listening', label: t.header.rep },
    { href: '/me', label: t.header.map },
    { href: '/opportunities', label: t.opportunities.nav },
    { href: '/invites', label: t.invites.nav },
    { href: '/me/data', label: t.header.data },
  ]

  // A page change closes it; so does Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function signOut() {
    await postJson('/api/auth/logout', {})
    router.replace('/login')
    router.refresh()
  }

  async function switchLanguage() {
    setSwitching(true)
    await postJson('/api/locale', { locale: locale === 'es' ? 'en' : 'es' })
    router.refresh()
    setSwitching(false)
  }

  const languageButton = (className: string) => (
    <button
      type="button"
      className={className}
      onClick={() => void switchLanguage()}
      disabled={switching}
      aria-label={t.header.switchToLabel}
      lang={locale === 'es' ? 'en' : 'es'}
    >
      {t.header.switchTo}
    </button>
  )

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark} aria-label="amble">
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
            <button type="button" className={`${styles.language} ${styles.wideOnly}`} onClick={() => void signOut()}>
              {t.login.signOut}
            </button>
          )}
          {language && languageButton(`${styles.language} ${showNav ? styles.wideOnly : ''}`)}
          {showNav && (
            <button
              type="button"
              className={styles.menuButton}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? t.header.closeMenu : t.header.openMenu}
              onClick={() => setOpen((value) => !value)}
            >
              <span className={open ? `${styles.burger} ${styles.burgerOpen}` : styles.burger} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {showNav && open && (
        <div id="site-menu" className={styles.menu}>
          <nav aria-label={t.header.nav}>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={pathname === item.href ? `${styles.menuLink} ${styles.menuLinkActive}` : styles.menuLink}
                aria-current={pathname === item.href ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.menuFoot}>
            {/* The same window as the button in the corner. */}
            <button
              type="button"
              className={styles.menuLink}
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new Event(OPEN_FEEDBACK))
              }}
            >
              {t.feedback.button}
            </button>
            {language && languageButton(styles.menuLink)}
            <button type="button" className={styles.menuLink} onClick={() => void signOut()}>
              {t.login.signOut}
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
