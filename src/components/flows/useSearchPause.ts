'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { postJson } from '@/components/api'

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
    const { ok, data } = await postJson<{ paused?: boolean }>('/api/search', { action: next ? 'pause' : 'resume' })
    if (ok && typeof data.paused === 'boolean') {
      setPaused(data.paused)
      if (!data.paused) setNote('resumed')
      router.refresh()
    } else setNote('failed')
    setSwitching(false)
  }

  return { paused, switching, note, toggle }
}
