'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import { useT } from '@/components/I18nProvider'
import styles from '@/app/onboarding/processing/processing.module.css'

interface LogEntry {
  key: string
  kind: 'activity' | 'discovery' | 'summary' | 'count'
  text?: string
  title?: string
  meta?: string
}

interface SourceItem {
  id: string
  name: string
  status: string
}

interface StageResponse {
  error?: string
  unconfigured?: boolean
  processed?: { name: string; claimsCount: number; discoveries: { title: string; meta: string }[] }[]
  totalClaims?: number
  evidenceCreated?: number
  capabilitiesCount?: number
  newUncertainties?: number
}

export default function ProcessingFlow() {
  const t = useT()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [working, setWorking] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const startedRef = useRef(false)

  function push(entry: Omit<LogEntry, 'key'>) {
    setEntries((prev) => [...prev, { ...entry, key: `${entry.kind}-${Math.random().toString(36).slice(2)}` }])
  }

  async function callStage(stage: string, sourceId?: string): Promise<StageResponse | null> {
    try {
      const response = await fetch('/api/onboarding/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourceId ? { stage, sourceId } : { stage }),
      })
      const data = (await response.json()) as StageResponse
      if (!response.ok) {
        setFailure(data.error ?? t.processing.failed)
        return null
      }
      return data
    } catch {
      setFailure(t.processing.unreachable)
      return null
    }
  }

  function pause(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function run() {
    setFailure(null)
    setDone(false)

    const listResponse = await fetch('/api/onboarding/sources')
    const sources = (await listResponse.json()) as SourceItem[]
    const pending = sources.filter((source) => source.status === 'extracted')
    if (pending.length === 0) {
      setFailure(t.processing.nothingToRead)
      return
    }

    let keptStatements = 0

    for (const source of pending) {
      push({ kind: 'activity', text: t.processing.reading(source.name) })
      setWorking(t.processing.reading(source.name))
      const result = await callStage('sources', source.id)
      if (!result) {
        setWorking(null)
        return
      }
      for (const processed of result.processed ?? []) {
        for (const discovery of processed.discoveries) {
          push({ kind: 'discovery', title: discovery.title, meta: discovery.meta })
          await pause(300)
        }
        keptStatements += processed.claimsCount
        push({ kind: 'summary', text: t.processing.kept(processed.claimsCount, processed.name) })
        await pause(400)
      }
    }

    if (keptStatements === 0) {
      setWorking(null)
      setFailure(t.processing.nothingExtracted)
      return
    }

    push({ kind: 'activity', text: t.processing.meaning })
    setWorking(t.processing.meaning)
    const evidenceResult = await callStage('evidence')
    if (!evidenceResult) {
      setWorking(null)
      return
    }
    push({ kind: 'count', text: t.processing.grounded(evidenceResult.evidenceCreated ?? 0) })
    await pause(500)

    push({ kind: 'activity', text: t.processing.connecting })
    setWorking(t.processing.connecting)
    const capabilitiesResult = await callStage('capabilities')
    if (!capabilitiesResult) {
      setWorking(null)
      return
    }
    push({ kind: 'count', text: t.processing.found(capabilitiesResult.capabilitiesCount ?? 0) })
    await pause(500)

    setWorking(t.processing.unknowns)
    const profileResult = await callStage('profile')
    if (!profileResult) {
      setWorking(null)
      return
    }

    setWorking(null)
    setDone(true)
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.status}>{t.processing.status}</h1>

        <div className={styles.log} aria-live="polite">
          {entries.map((entry) =>
            entry.kind === 'discovery' ? (
              <div key={entry.key} className={`${styles.entry} ${styles.entryDiscovery}`}>
                <div>
                  <p className={styles.discoveryTitle}>{entry.title}</p>
                  <p className={styles.discoveryMeta}>{entry.meta}</p>
                </div>
                <span className={styles.discoveryCheck} aria-label={t.processing.foundLabel}>
                  ✓
                </span>
              </div>
            ) : (
              <p
                key={entry.key}
                className={`${styles.entry} ${entry.kind === 'count' || entry.kind === 'summary' ? styles.entryCount : styles.entryActivity}`}
              >
                {entry.text}
              </p>
            ),
          )}

          {working && (
            <div className={styles.workingRow} role="status">
              <StatusDot />
              <span>{working}</span>
            </div>
          )}
        </div>

        {failure && (
          <div className={styles.done}>
            <p className={styles.doneLine}>{t.processing.failedTitle}</p>
            <p className={styles.doneDetail}>{failure}</p>
            <p className={styles.doneDetail}>{t.processing.nothingInvented}</p>
            <div className={styles.doneCta}>
              <button type="button" className="btn" onClick={() => void run()}>
                {t.common.tryAgain}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className={styles.done}>
            <p className={styles.doneLine}>{t.processing.doneTitle}</p>
            <p className={styles.doneDetail}>
              {t.processing.doneDetail}
            </p>
            <div className={styles.doneCta}>
              <Link href="/onboarding/interview" className="btn">
                {t.common.continue}
              </Link>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
