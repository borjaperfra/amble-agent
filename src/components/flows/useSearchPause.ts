'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Pausing and resuming the search, the same from /listening and from /me:
// at once, and then the page reads its state again.
export function useSearchPause(initial: boolean) {
  const router = useRouter()
  const [paused, setPaused] = useState(initial)
  const [switching, setSwitching] = useState(false)
  const [note, setNote] = useState<'resumed' | 'failed' | null>(null)

  async function toggle() {
    const next = !paused
    setSwitching(true)
    setNote(null)
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'pause' : 'resume' }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const result = (await response.json()) as { paused: boolean }
      setPaused(result.paused)
      if (!result.paused) setNote('resumed')
      router.refresh()
    } catch {
      setNote('failed')
    } finally {
      setSwitching(false)
    }
  }

  return { paused, switching, note, toggle }
}
