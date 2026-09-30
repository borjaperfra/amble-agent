'use client'

import { useEffect, useRef, useState } from 'react'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import { applicationAction } from '@/components/api'
import { useVisibleInterval } from './useVisibleInterval'
import styles from '@/app/opportunities/application.module.css'

// The form open in a browser in the cloud, shown here, live: they check what
// amble filled, finish what is theirs, pass a "not a robot" check if there is
// one, and send it themselves. Every few seconds while it is on screen, amble
// looks whether it was sent, or closed.

const LOOK_MS = 3000

export default function LiveForm({ opportunityId, company, left, onSent, onClosed }: { opportunityId: string; company: string; left: string[]; onSent: () => void; onClosed: () => void }) {
  const a = useT().opportunities.apply
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [watching, setWatching] = useState(true)
  // The latest callbacks, without restarting the watch when the page redraws.
  const done = useRef({ onSent, onClosed })
  useEffect(() => {
    done.current = { onSent, onClosed }
  })

  useEffect(() => {
    let alive = true
    applicationAction({ action: 'live', opportunityId })
      .then((data) => {
        if (!alive) return
        if (typeof data.url === 'string') setUrl(data.url)
        else setMissing(true)
      })
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
    }
  }, [opportunityId])

  useVisibleInterval(
    async () => {
      try {
        const { state } = await applicationAction<{ state: string }>({ action: 'status', opportunityId })
        if (state === 'sent') {
          setWatching(false)
          done.current.onSent()
        } else if (state === 'closed' || state === 'none') {
          setWatching(false)
          done.current.onClosed()
        }
      } catch {
        // A missed look; the next one tells.
      }
    },
    LOOK_MS,
    watching,
  )

  async function close() {
    await applicationAction({ action: 'cancel', opportunityId }).catch(() => undefined)
    onClosed()
  }

  // The form is gone: only that, not the words about a form on screen.
  if (missing) {
    return (
      <section className={styles.review}>
        <p className={styles.warning} role="alert">
          {a.liveGone}
        </p>
      </section>
    )
  }

  return (
    <section className={styles.review}>
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
        // A page from another site, kept apart: it can run and keep its own
        // session, but cannot open windows, navigate this one or reach amble.
        <iframe
          className={styles.live}
          src={url}
          title={a.liveTitle(company)}
          sandbox="allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className={styles.working} role="status">
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
