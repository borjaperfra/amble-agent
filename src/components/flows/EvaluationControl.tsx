'use client'

import { useState } from 'react'
import { useT } from '@/components/I18nProvider'
import styles from './evaluation.module.css'

interface EvaluationControlProps {
  targetType: 'capability' | 'interview_question'
  targetId: string
  label: string
  verdicts: string[]
}

export function EvaluationControl({ targetType, targetId, label, verdicts }: EvaluationControlProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)

  async function send() {
    if (!verdict) return
    try {
      await fetch('/api/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, verdict, comment }),
      })
    } catch {
      // Evaluation is observational; failures are silent for the flow.
    }
    setSent(true)
  }

  if (!targetId) return null

  return (
    <div className={styles.wrap}>
      {!open && !sent && (
        <button type="button" className={styles.toggle} onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      {open && !sent && (
        <div className={styles.panel}>
          <div className={styles.options}>
            {verdicts.map((option) => (
              <button
                key={option}
                type="button"
                className={verdict === option ? `${styles.option} ${styles.optionActive}` : styles.option}
                onClick={() => setVerdict(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <input
            type="text"
            className={styles.comment}
            placeholder={t.evaluation.comment}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>
              {t.common.cancel}
            </button>
            <button type="button" className={styles.send} disabled={!verdict} onClick={() => void send()}>
              {t.evaluation.record}
            </button>
          </div>
        </div>
      )}
      {sent && <p className={styles.sent}>{t.evaluation.recorded}</p>}
    </div>
  )
}
