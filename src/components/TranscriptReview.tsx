'use client'

import { useId } from 'react'
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

  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor={id}>
        Your answer — edit it if you&rsquo;d like
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
          Discard
        </button>
        <button type="button" className="btn" onClick={onKeep}>
          Keep this answer
        </button>
      </div>
    </div>
  )
}
