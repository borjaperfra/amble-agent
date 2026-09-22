'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './Header.module.css'

const navItems = [
  { href: '/listening', label: 'Your Rep' },
  { href: '/me', label: 'Your Map' },
  { href: '/me/intent', label: 'Listening for' },
  // No es producto: es la libreta de lo que hay que arreglar del producto.
  // Está en la barra porque una idea a la que hay que llegar escribiendo una
  // URL a mano es una idea que no se apunta.
  { href: '/feedback', label: 'Ideas' },
  { href: '/admin', label: 'Panel' },
]

const navRoutes = ['/me', '/me/intent', '/listening', '/feedback', '/admin']

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
