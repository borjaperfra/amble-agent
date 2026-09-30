'use client'

import { useState } from 'react'
import { useT } from '@/components/I18nProvider'
import { postJson, requestJson } from '@/components/api'
import { useVisibleInterval } from './useVisibleInterval'
import styles from '@/app/opportunities/opportunities.module.css'

const LOOK_MS = 4000

// Linking WhatsApp: a link opens it with the message written, they send it,
// and the page sees it arrive. Linked, amble asks there how applications go.
export default function WhatsAppConnect({ linked: initiallyLinked }: { linked: boolean }) {
  const w = useT().whatsapp
  const [linked, setLinked] = useState(initiallyLinked)
  const [waiting, setWaiting] = useState(false)
  const [failed, setFailed] = useState(false)

  // While they are in WhatsApp this tab is in the background: it looks again
  // as soon as they are back, and every few seconds while they are here.
  useVisibleInterval(
    async () => {
      const { ok, data } = await requestJson<{ linked?: boolean }>('/api/whatsapp')
      if (ok && data.linked) {
        setLinked(true)
        setWaiting(false)
      }
    },
    LOOK_MS,
    waiting,
  )

  async function post(action: 'start' | 'unlink') {
    setFailed(false)
    const { ok, data } = await postJson<{ url?: string }>('/api/whatsapp', { action })
    if (ok) return data
    setFailed(true)
    return null
  }

  async function connect() {
    // Opened now, while the tap still counts as theirs, then pointed at WhatsApp.
    const opened = window.open('', '_blank')
    const result = await post('start')
    if (!result?.url) {
      opened?.close()
      return
    }
    if (opened) {
      // What opens there cannot reach back into amble.
      opened.opener = null
      opened.location.href = result.url
    } else window.location.href = result.url
    setWaiting(true)
  }

  return (
    <section className={styles.whatsapp}>
      <h2 className={styles.whatsappTitle}>{w.connectTitle}</h2>
      <p className={styles.whatsappLead} aria-live="polite">
        {linked ? w.connected : waiting ? w.connectWaiting : w.connectLead}
      </p>
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
