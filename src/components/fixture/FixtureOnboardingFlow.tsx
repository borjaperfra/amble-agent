'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import { fixtureSources } from '@/fixtures/candidate'
import styles from '@/app/onboarding/onboarding.module.css'

export default function FixtureOnboardingFlow() {
  const router = useRouter()
  const [connected, setConnected] = useState<Record<string, boolean>>({})

  const anyConnected = Object.values(connected).some(Boolean)

  function connect(id: string) {
    setConnected((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>Let&rsquo;s build your Rep.</h1>
        <p className={styles.body}>
          {'Start with what already exists.\nI\u2019ll read it before asking you anything.'}
        </p>

        <div className={styles.sources}>
          {fixtureSources.map((source) => {
            const isConnected = Boolean(connected[source.id])
            if (source.prominent) {
              return (
                <button
                  key={source.id}
                  type="button"
                  className={
                    isConnected
                      ? `${styles.fileDrop} ${styles.fileDropConnected} ${styles.enter}`
                      : styles.fileDrop
                  }
                  onClick={() => connect(source.id)}
                  disabled={isConnected}
                  aria-label={
                    isConnected ? 'CV added: borja-perez-cv.pdf' : 'Add your CV'
                  }
                >
                  <span className={styles.fileDropMain}>
                    <span className={styles.fileDropLabel}>CV</span>
                    <span className={styles.fileDropHint}>
                      {isConnected
                        ? 'borja-perez-cv.pdf'
                        : 'Drop a PDF here, or choose a file'}
                    </span>
                  </span>
                  <span className={styles.rowRight}>
                    {isConnected ? (
                      <span className={`${styles.check} ${styles.enter}`} aria-hidden="true">
                        ✓
                      </span>
                    ) : (
                      <span className={styles.rowAction}>Add →</span>
                    )}
                  </span>
                </button>
              )
            }
            return (
              <button
                key={source.id}
                type="button"
                className={
                  isConnected ? `${styles.row} ${styles.rowConnected} ${styles.enter}` : styles.row
                }
                onClick={() => connect(source.id)}
                disabled={isConnected}
                aria-label={isConnected ? `${source.label} connected` : `${source.label}: ${source.action}`}
              >
                <span className={styles.rowLabel}>{source.label}</span>
                <span className={styles.rowRight}>
                  {isConnected ? (
                    <>
                      <span className={styles.rowIdentifier}>{source.identifier}</span>
                      <span className={styles.check} aria-hidden="true">
                        ✓
                      </span>
                    </>
                  ) : (
                    <span className={styles.rowAction}>{source.action} →</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        <p className={styles.notice}>Nothing here is required. Continue with what you have.</p>

        <div className={styles.footer}>
          <button
            type="button"
            className="btn"
            disabled={!anyConnected}
            onClick={() => router.push('/onboarding/processing')}
          >
            Continue →
          </button>
        </div>
      </main>
    </>
  )
}
