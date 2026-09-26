'use client'

import { useId } from 'react'
import { useT } from './I18nProvider'
import styles from './TranscriptReview.module.css'

interface TranscriptReviewProps {
  value: string
  onChange: (value: string) => void
  onKeep: () => void
  onDiscard: () => void
}

export default function TranscriptReview({
  value,
  onChange,
  onKeep,
  onDiscard,
}: TranscriptReviewProps) {
  const id = useId()
  const t = useT()

  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor={id}>
        {t.voice.transcriptLabel}
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        value={value}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={styles.actions}>
        <button type="button" className="text-btn" onClick={onDiscard}>
          {t.voice.discard}
        </button>
        <button type="button" className="btn" onClick={onKeep}>
          {t.voice.keep}
        </button>
      </div>
    </div>
  )
}
