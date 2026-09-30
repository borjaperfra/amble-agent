'use client'

import { useCallback, useEffect, useState } from 'react'

// What someone is writing, kept on their device as they type: a reload, a
// page the browser drops in the background, or a lost connection does not
// take it away. Cleared once it has been kept for real.
const PREFIX = 'amble-draft:'

function read(key: string): string {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    if (value.trim()) window.localStorage.setItem(PREFIX + key, value)
    else window.localStorage.removeItem(PREFIX + key)
  } catch {
    // Storage unavailable (a private window): the draft lives only on screen.
  }
}

export function useDraft(key: string | null): [string, (value: string | ((previous: string) => string)) => void, () => void] {
  const [value, setValue] = useState('')

  // After the first paint, so the page the server sent and the one here agree.
  useEffect(() => {
    if (!key) return
    const id = window.setTimeout(() => {
      const saved = read(key)
      setValue((current) => (current.trim() ? current : saved))
    }, 0)
    return () => window.clearTimeout(id)
  }, [key])

  const set = useCallback(
    (next: string | ((previous: string) => string)) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? next(previous) : next
        if (key) write(key, resolved)
        return resolved
      })
    },
    [key],
  )

  const clear = useCallback(() => {
    if (key) write(key, '')
  }, [key])

  return [value, set, clear]
}
