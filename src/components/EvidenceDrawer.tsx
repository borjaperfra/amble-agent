'use client'

import { useEffect, useRef, useState } from 'react'
import { postJson } from './api'
import type { Capability, Evidence } from '@/domains/candidate/types'
import { useT } from './I18nProvider'
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
  const t = useT()
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
            <p className="kicker">{t.evidence.kicker}</p>
            <h2 id="evidence-drawer-title" className={styles.title}>
              {capability.name}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t.evidence.closeLabel}
          >
            {t.common.close}
          </button>
        </div>

        <p className={styles.summary}>{capability.explanation}</p>

        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.source}>
                  {t.source[item.sourceType as keyof typeof t.source] ?? item.sourceType}
                </span>
                {showEpistemicState && item.epistemicState ? (
                  <span className={styles.epistemic}>{item.epistemicState}</span>
                ) : null}
                {item.date ? <span className={styles.date}>{item.date}</span> : null}
                {item.confirmed ? (
                  <span className={styles.confirmed}>{t.evidence.confirmed}</span>
                ) : null}
              </div>
              <p className={styles.claim}>{item.claim}</p>
              <p className={styles.supports}>{item.supports}</p>
            </li>
          ))}
        </ul>

        <AddEvidence capabilityId={capability.id} />

        <p className={styles.note}>{t.evidence.private}</p>
      </div>
    </div>
  )
}

// Proof of this capability, brought from here without waiting for a
// question (#24): words, a link, or both; taken in in the background.
function AddEvidence({ capabilityId }: { capabilityId: string }) {
  const t = useT()
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [problem, setProblem] = useState<string | null>(null)

  async function send() {
    if (!text.trim()) return
    setState('sending')
    setProblem(null)
    const { ok, data } = await postJson<{ problems?: string[] }>('/api/career/evidence', { capabilityId, text })
    if (!ok) {
      setState('failed')
      setProblem(data.error ?? null)
      return
    }
    setText('')
    setState('sent')
    setProblem(data.problems?.[0] ?? null)
  }

  return (
    <section className={styles.add}>
      <h3 className={styles.addTitle}>{t.evidence.addTitle}</h3>
      <p className={styles.addHint}>{t.evidence.addHint}</p>
      <textarea
        className={styles.addText}
        value={text}
        maxLength={4000}
        rows={3}
        placeholder={t.evidence.addPlaceholder}
        onChange={(event) => {
          setText(event.target.value)
          if (state !== 'sending') setState('idle')
        }}
      />
      <button type="button" className="btn" onClick={() => void send()} disabled={state === 'sending' || !text.trim()}>
        {state === 'sending' ? t.evidence.adding : t.evidence.addButton}
      </button>
      {state === 'sent' && <p className={styles.addDone}>{t.evidence.added}</p>}
      {state === 'failed' && <p className={styles.addProblem}>{problem ?? t.evidence.addFailed}</p>}
      {state === 'sent' && problem && <p className={styles.addProblem}>{problem}</p>}
    </section>
  )
}
