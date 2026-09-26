'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from './I18nProvider'
import styles from './InlineEdit.module.css'

interface InlineEditProps {
  value: string
  onChange: (value: string) => void
  label: string
}

export default function InlineEdit({ value, onChange, label }: InlineEditProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  if (prevValue !== value) {
    setPrevValue(value)
    setDraft(value)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const next = draft.trim()
    if (next && next !== value) onChange(next)
    setEditing(false)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.input}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') cancel()
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={styles.trigger}
      onClick={() => setEditing(true)}
      aria-label={t.voice.change(label, value)}
    >
      {value}
    </button>
  )
}
