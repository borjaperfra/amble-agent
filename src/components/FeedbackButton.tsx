'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useT } from './I18nProvider'
import { postJson } from './api'
import styles from './FeedbackButton.module.css'

// Always at hand for someone in the beta: say what does not work or what is
// missing, from wherever they are. It reaches the person building amble.
// The menu opens it too (Header), with this event.
export const OPEN_FEEDBACK = 'amble:open-feedback'

export default function FeedbackButton() {
  const t = useT().feedback
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) box.current?.focus()
  }, [open])

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_FEEDBACK, onOpen)
    return () => window.removeEventListener(OPEN_FEEDBACK, onOpen)
  }, [])

  // Escape closes it, as any small window.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!message.trim()) return
    setState('sending')
    if (!(await postJson('/api/feedback', { message, page: pathname })).ok) {
      setState('failed')
      return
    }
    setState('sent')
    setMessage('')
    window.setTimeout(() => {
      setOpen(false)
      setState('idle')
    }, 2200)
  }

  return (
    <div className={styles.wrap}>
      {open && (
        <form className={styles.panel} onSubmit={(event) => void send(event)} aria-label={t.title}>
          {state === 'sent' ? (
            <p className={styles.thanks} role="status">
              {t.thanks}
            </p>
          ) : (
            <>
              <label className={styles.title} htmlFor="feedback-message">
                {t.title}
              </label>
              <p className={styles.lead}>{t.lead}</p>
              <textarea
                id="feedback-message"
                ref={box}
                className={styles.box}
                rows={4}
                maxLength={4000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              {state === 'failed' && (
                <p className={styles.error} role="alert">
                  {t.failed}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className="btn" disabled={state === 'sending' || !message.trim()}>
                  {state === 'sending' ? t.sending : t.send}
                </button>
                <button type="button" className="text-btn" onClick={() => setOpen(false)}>
                  {t.close}
                </button>
              </div>
            </>
          )}
        </form>
      )}
      {/* On a phone, only the icon: small enough never to cover text or a field. */}
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <svg className={styles.icon} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span className={styles.label}>{t.button}</span>
      </button>
    </div>
  )
}
