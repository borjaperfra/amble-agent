'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import { processingDone, processingIntro, processingSteps } from '@/fixtures/processing'
import styles from '@/app/onboarding/processing/processing.module.css'

const stepDelay: Record<string, number> = {
  activity: 950,
  discovery: 650,
  summary: 1100,
  count: 900,
}

export default function FixtureProcessingFlow() {
  const [visibleCount, setVisibleCount] = useState(0)
  const [done, setDone] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visibleCount < processingSteps.length) {
      const step = processingSteps[visibleCount]
      timeoutRef.current = window.setTimeout(
        () => setVisibleCount((count) => count + 1),
        stepDelay[step.kind] ?? 700,
      )
    } else {
      timeoutRef.current = window.setTimeout(() => setDone(true), 1200)
    }
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [visibleCount])

  useEffect(() => {
    if (done) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [done])

  const visible = processingSteps.slice(0, visibleCount)

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.status}>{processingIntro}</h1>

        <div className={styles.log} aria-live="polite">
          {visible.map((step, index) => {
            if (step.kind === 'discovery') {
              return (
                <div key={index} className={`${styles.entry} ${styles.entryDiscovery}`}>
                  <div>
                    <p className={styles.discoveryTitle}>{step.title}</p>
                    <p className={styles.discoveryMeta}>{step.meta}</p>
                  </div>
                  <span className={styles.discoveryCheck} aria-label="Found">
                    ✓
                  </span>
                </div>
              )
            }
            if (step.kind === 'activity') {
              return (
                <p key={index} className={`${styles.entry} ${styles.entryActivity}`}>
                  {step.text}
                </p>
              )
            }
            return (
              <p
                key={index}
                className={`${styles.entry} ${step.kind === 'count' ? styles.entryCount : styles.entrySummary}`}
              >
                {step.text}
              </p>
            )
          })}
        </div>

        <div ref={bottomRef} />

        {done && (
          <div className={styles.done}>
            <p className={styles.doneLine}>{processingDone.line}</p>
            <p className={styles.doneDetail}>{processingDone.detail}</p>
            <div className={styles.doneCta}>
              <Link href="/onboarding/interview" className="btn">
                {processingDone.cta} →
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
