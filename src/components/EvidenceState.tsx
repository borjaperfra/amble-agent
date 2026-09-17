import {
  strengthLabel,
  strengthLevel,
  type EvidenceStrength,
} from '@/domains/candidate/types'
import styles from './EvidenceState.module.css'

interface EvidenceStateProps {
  strength: EvidenceStrength
  showLabel?: boolean
}

export default function EvidenceState({ strength, showLabel = true }: EvidenceStateProps) {
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
      <span className={styles.wrap} role="img" aria-label={strengthLabel[strength]}>
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
      <span className={styles.label}>{strengthLabel[strength]}</span>
    </span>
  )
}
