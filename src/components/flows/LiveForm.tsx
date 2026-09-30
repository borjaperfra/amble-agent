'use client'

import { useEffect, useRef, useState } from 'react'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/opportunities/application.module.css'

// The form open in a browser in the cloud, shown here, live: they check what
// amble filled, finish what is theirs, pass a "not a robot" check if there is
// one, and send it themselves. Every few seconds amble looks whether it was
// sent, or closed.

async function post(body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('failed')
  return (await response.json()) as Record<string, unknown>
}

export default function LiveForm({ opportunityId, company, left, onSent, onClosed }: { opportunityId: string; company: string; left: string[]; onSent: () => void; onClosed: () => void }) {
  const a = useT().opportunities.apply
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  // The latest callbacks, without restarting the watch when the page redraws.
  const done = useRef({ onSent, onClosed })
  useEffect(() => {
    done.current = { onSent, onClosed }
  })

  useEffect(() => {
    let alive = true
    void post({ action: 'live', opportunityId })
      .then((data) => {
        if (!alive) return
        if (typeof data.url === 'string') setUrl(data.url)
        else setMissing(true)
      })
      .catch(() => alive && setMissing(true))
    const timer = window.setInterval(async () => {
      try {
        const { state } = (await post({ action: 'status', opportunityId })) as { state: string }
        if (state === 'sent') {
          window.clearInterval(timer)
          done.current.onSent()
        } else if (state === 'closed' || state === 'none') {
          window.clearInterval(timer)
          done.current.onClosed()
        }
      } catch {
        // A missed look; the next one tells.
      }
    }, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [opportunityId])

  async function close() {
    await post({ action: 'cancel', opportunityId }).catch(() => undefined)
    onClosed()
  }

  return (
    <section className={styles.review} role="status">
      <p className={styles.windowLine}>
        <Symbol size={28} watch breathe />
        <span>{a.liveOpen(company)}</span>
      </p>
      {left.length > 0 && (
        <>
          <p className={styles.reviewLead}>{a.windowLeft}</p>
          <ul className={styles.leftList}>
            {left.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </>
      )}
      {url ? (
        <iframe className={styles.live} src={url} title={a.liveTitle(company)} sandbox="allow-same-origin allow-scripts" allow="clipboard-read; clipboard-write" />
      ) : missing ? (
        <p className={styles.warning}>{a.liveGone}</p>
      ) : (
        <div className={styles.working}>
          <Symbol size={24} watch breathe />
        </div>
      )}
      <p className={styles.note}>{a.liveWatch}</p>
      {url && (
        <div className={styles.reviewActions}>
          <button type="button" className="text-btn" onClick={() => void close()}>
            {a.liveClose}
          </button>
        </div>
      )}
    </section>
  )
}
