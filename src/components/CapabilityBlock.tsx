'use client'

import { useState } from 'react'
import EvidenceState from './EvidenceState'
import { useT } from './I18nProvider'
import type { EvidenceStrength } from '@/domains/candidate/types'
import styles from './CapabilityBlock.module.css'

interface CapabilityBlockProps {
  name: string
  strength: EvidenceStrength
  explanation: string
  count: number
  onView: () => void
}

export default function CapabilityBlock({
  name,
  strength,
  explanation,
  count,
  onView,
}: CapabilityBlockProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <article className={styles.block}>
      <div className={styles.head}>
        <h3 className={styles.name}>{name}</h3>
        <EvidenceState strength={strength} />
      </div>
      {/* Two lines to scan the map; the whole reason when they ask. */}
      <p className={open ? styles.explanation : `${styles.explanation} ${styles.clamped}`}>{explanation}</p>
      <div className={styles.meta}>
        <span className={styles.count}>
          {t.map.pieces(count)}
        </span>
        <button type="button" className="text-btn" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? t.map.showLess : t.map.showMore}
        </button>
        <button type="button" className="text-btn" onClick={onView}>
          {t.map.view}
        </button>
      </div>
    </article>
  )
}
