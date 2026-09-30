'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useT } from './I18nProvider'
import { postJson } from './api'
import styles from './FeedbackButton.module.css'

// Always at hand for someone in the beta: say what does not work or what is
// missing, from wherever they are. It reaches the person building amble.

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
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t.button}
      </button>
    </div>
  )
}
