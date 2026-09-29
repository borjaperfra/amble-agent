'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/opportunities/opportunities.module.css'

const LOOK_MS = 4000

// Linking WhatsApp: a link opens it with the message written, they send it,
// and the page sees it arrive. Linked, amble asks there how applications go.
export default function WhatsAppConnect({ linked: initiallyLinked }: { linked: boolean }) {
  const w = useT().whatsapp
  const [linked, setLinked] = useState(initiallyLinked)
  const [waiting, setWaiting] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(async () => {
      try {
        const state = (await fetch('/api/whatsapp').then((response) => response.json())) as { linked?: boolean }
        if (state.linked) {
          setLinked(true)
          setWaiting(false)
        }
      } catch {
        // A missed look; the next one tells.
      }
    }, LOOK_MS)
    return () => window.clearInterval(id)
  }, [waiting])

  async function post(action: 'start' | 'unlink') {
    setFailed(false)
    try {
      const response = await fetch('/api/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error(String(response.status))
      return (await response.json()) as { url?: string }
    } catch {
      setFailed(true)
      return null
    }
  }

  async function connect() {
    // Opened now, while the tap still counts as theirs, then pointed at WhatsApp.
    const opened = window.open('', '_blank')
    const result = await post('start')
    if (!result?.url) {
      opened?.close()
      return
    }
    if (opened) opened.location.href = result.url
    else window.location.href = result.url
    setWaiting(true)
  }

  return (
    <section className={styles.whatsapp}>
      <h2 className={styles.whatsappTitle}>{w.connectTitle}</h2>
      <p className={styles.whatsappLead}>{linked ? w.connected : waiting ? w.connectWaiting : w.connectLead}</p>
      <div className={styles.whatsappActions}>
        {linked ? (
          <button
            type="button"
            className="text-btn"
            onClick={async () => {
              if (await post('unlink')) setLinked(false)
            }}
          >
            {w.disconnect}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void connect()}>
            {w.connect}
          </button>
        )}
      </div>
      {failed && (
        <p className={styles.error} role="alert">
          {w.unavailable}
        </p>
      )}
    </section>
  )
}
