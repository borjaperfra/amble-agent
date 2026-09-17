'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './Header.module.css'

const navItems = [
  { href: '/listening', label: 'Your Rep' },
  { href: '/me', label: 'Your Map' },
  { href: '/me/intent', label: 'Listening for' },
]

const navRoutes = ['/me', '/me/intent', '/listening']

interface HeaderProps {
  right?: React.ReactNode
}

export default function Header({ right }: HeaderProps) {
  const pathname = usePathname()
  const showNav = navRoutes.includes(pathname)

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          amble
        </Link>
        {showNav && (
          <nav className={styles.nav} aria-label="Primary">
            {navItems.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                  }
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}
        {right ? <div className={styles.right}>{right}</div> : null}
      </div>
    </header>
  )
}
