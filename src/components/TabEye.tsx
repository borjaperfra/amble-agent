'use client'

import { useEffect } from 'react'
import { useT } from './I18nProvider'

// In a background tab the tab says so and its eye closes; it opens again when
// you come back. The same behaviour as amble-web (layouts/Base.astro).
export default function TabEye() {
  const t = useT()

  useEffect(() => {
    let title: string | null = null
    const onVisibility = () => {
      const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
      if (document.hidden) {
        title = document.title
        document.title = t.meta.away
        icon?.setAttribute('href', '/favicon-closed.svg')
      } else if (title !== null) {
        document.title = title
        title = null
        icon?.setAttribute('href', '/favicon.svg')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [t])

  return null
}
