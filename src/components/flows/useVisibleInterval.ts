'use client'

import { useEffect, useRef } from 'react'

// Looking again every few seconds, but only while the page is on screen: in a
// background tab it rests, and it looks at once when they come back.
export function useVisibleInterval(callback: () => void, ms: number, enabled: boolean) {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })

  useEffect(() => {
    if (!enabled) return
    let id = 0
    const start = () => {
      window.clearInterval(id)
      id = window.setInterval(() => latest.current(), ms)
    }
    const onVisibility = () => {
      if (document.hidden) window.clearInterval(id)
      else {
        latest.current()
        start()
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled])
}
