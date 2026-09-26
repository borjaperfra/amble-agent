'use client'

import { strengthLevel, type EvidenceStrength } from '@/domains/candidate/types'
import { useT } from './I18nProvider'
import styles from './EvidenceState.module.css'

interface EvidenceStateProps {
  strength: EvidenceStrength
  showLabel?: boolean
}

export default function EvidenceState({ strength, showLabel = true }: EvidenceStateProps) {
  const t = useT()
  const label = t.strength[strength]
  const level = strengthLevel[strength]
  const contradictory = strength === 'contradictory'
  const dots = [0, 1, 2, 3].map((i) => {
    const filled = i < level
    if (contradictory) {
      return (
        <span
          key={i}
          className={
            filled ? `${styles.dot} ${styles.dotContradictoryFilled}` : `${styles.dot} ${styles.dotContradictory}`
          }
        />
      )
    }
    return (
      <span key={i} className={filled ? `${styles.dot} ${styles.dotFilled}` : styles.dot} />
    )
  })

  if (!showLabel) {
    return (
      <span className={styles.wrap} role="img" aria-label={label}>
        <span className={styles.dots} aria-hidden="true">
          {dots}
        </span>
      </span>
    )
  }

  return (
    <span className={styles.wrap}>
      <span className={styles.dots} aria-hidden="true">
        {dots}
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  )
}
