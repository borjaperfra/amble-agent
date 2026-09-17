'use client'

import Link from 'next/link'
import { useState } from 'react'
import Header from '@/components/Header'
import styles from '@/app/onboarding/processing/processing.module.css'

interface LogEntry {
  key: string
  kind: 'activity' | 'discovery' | 'summary' | 'count'
  text?: string
  title?: string
  meta?: string
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

export default function UserZeroProcessingFlow() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  function push(entry: Omit<LogEntry, 'key'>) {
    setEntries((prev) => [...prev, { ...entry, key: `${entry.kind}-${Math.random().toString(36).slice(2)}` }])
  }

  async function callStage(stage: string): Promise<StageResponse | null> {
    try {
      const response = await fetch('/api/onboarding/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      const data = (await response.json()) as StageResponse
      if (!response.ok) {
        setFailure(data.error ?? 'Processing failed.')
        return null
      }
      return data
    } catch {
      setFailure('Processing failed: the server could not be reached.')
      return null
    }
  }

  function pause(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function run() {
    setRunning(true)
    setFailure(null)
    setEntries([])
    setDone(false)

    const sourcesResult = await callStage('sources')
    if (!sourcesResult) {
      setRunning(false)
      return
    }

    const processed = sourcesResult.processed ?? []
    if (processed.length > 0 && (sourcesResult.totalClaims ?? 0) === 0) {
      setFailure(
        `I read ${processed.map((source) => source.name).join(', ')} but couldn't extract a single professional statement. That is probably my failure, not yours — the document may be unusual. Try again, or use a plain text export.`,
      )
      setRunning(false)
      return
    }

    for (const source of processed) {
      push({ kind: 'activity', text: `Reading ${source.name}...` })
      await pause(500)
      for (const discovery of source.discoveries) {
        push({ kind: 'discovery', title: discovery.title, meta: discovery.meta })
        await pause(420)
      }
      push({
        kind: 'summary',
        text:
          processed.length > 1
            ? `I kept ${source.claimsCount} statements from ${source.name}.`
            : `I kept ${source.claimsCount} statements from what you gave me.`,
      })
      await pause(500)
    }

    push({ kind: 'activity', text: 'Looking at what it all means...' })
    const evidenceResult = await callStage('evidence')
    if (!evidenceResult) {
      setRunning(false)
      return
    }
    push({ kind: 'count', text: `Grounded ${evidenceResult.evidenceCreated ?? 0} pieces of evidence.` })
    await pause(600)

    push({ kind: 'activity', text: 'Connecting the dots...' })
    const capabilitiesResult = await callStage('capabilities')
    if (!capabilitiesResult) {
      setRunning(false)
      return
    }
    push({ kind: 'count', text: `Found ${capabilitiesResult.capabilitiesCount ?? 0} capabilities.` })
    await pause(600)

    push({ kind: 'activity', text: 'Noting what I still don\'t know...' })
    const profileResult = await callStage('profile')
    if (!profileResult) {
      setRunning(false)
      return
    }

    setDone(true)
    setRunning(false)
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.status}>Getting to know you.</h1>

        <div className={styles.log} aria-live="polite">
          {entries.map((entry) =>
            entry.kind === 'discovery' ? (
              <div key={entry.key} className={`${styles.entry} ${styles.entryDiscovery}`}>
                <div>
                  <p className={styles.discoveryTitle}>{entry.title}</p>
                  <p className={styles.discoveryMeta}>{entry.meta}</p>
                </div>
                <span className={styles.discoveryCheck} aria-label="Found">
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
        </div>

        {failure && (
          <div className={styles.done}>
            <p className={styles.doneLine}>Something didn&apos;t work.</p>
            <p className={styles.doneDetail}>{failure}</p>
            <p className={styles.doneDetail}>Nothing has been invented to fill the gap.</p>
            <div className={styles.doneCta}>
              <button type="button" className="btn" onClick={run} disabled={running}>
                Try again →
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className={styles.done}>
            <p className={styles.doneLine}>I have the basics.</p>
            <p className={styles.doneDetail}>
              {'There are a few things\nI\u2019d rather ask you myself.'}
            </p>
            <div className={styles.doneCta}>
              <Link href="/onboarding/interview" className="btn">
                Continue →
              </Link>
            </div>
          </div>
        )}

        {!done && !failure && !running && (
          <div className={styles.doneCta}>
            <button type="button" className="btn" onClick={run}>
              Start reading →
            </button>
          </div>
        )}
      </main>
    </>
  )
}
