'use client'

import { useEffect, useRef } from 'react'
import type { Capability, Evidence } from '@/domains/candidate/types'
import { sourceTypeLabel } from '@/domains/candidate/types'
import styles from './EvidenceDrawer.module.css'

interface EvidenceDrawerProps {
  capability: Capability
  items: Evidence[]
  showEpistemicState?: boolean
  onClose: () => void
}

function trapFocus(panel: HTMLElement, event: KeyboardEvent) {
  const focusable = panel.querySelectorAll<HTMLElement>(
    'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export default function EvidenceDrawer({
  capability,
  items,
  showEpistemicState = false,
  onClose,
}: EvidenceDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'Tab' && panelRef.current) {
        trapFocus(panelRef.current, event)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      aria-hidden="false"
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div>
            <p className="kicker">Evidence</p>
            <h2 id="evidence-drawer-title" className={styles.title}>
              {capability.name}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close evidence"
          >
            Close
          </button>
        </div>

        <p className={styles.summary}>{capability.explanation}</p>

        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.source}>
                  {sourceTypeLabel[item.sourceType] ?? item.sourceType}
                </span>
                {showEpistemicState && item.epistemicState ? (
                  <span className={styles.epistemic}>{item.epistemicState}</span>
                ) : null}
                {item.date ? <span className={styles.date}>{item.date}</span> : null}
                {item.confirmed ? (
                  <span className={styles.confirmed}>You confirmed this</span>
                ) : null}
              </div>
              <p className={styles.claim}>{item.claim}</p>
              <p className={styles.supports}>{item.supports}</p>
            </li>
          ))}
        </ul>

        <p className={styles.note}>Private. Only you can see this.</p>
      </div>
    </div>
  )
}
