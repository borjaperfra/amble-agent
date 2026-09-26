'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
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
    setFailure(null)
    setDone(false)

    const listResponse = await fetch('/api/onboarding/sources')
    const sources = (await listResponse.json()) as SourceItem[]
    const pending = sources.filter((source) => source.status === 'extracted')
    if (pending.length === 0) {
      setFailure('There are no unread sources to process. Go back and add one.')
      return
    }

    let keptStatements = 0

    for (const source of pending) {
      push({ kind: 'activity', text: `Reading ${source.name}...` })
      setWorking(`Reading ${source.name}...`)
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
        push({ kind: 'summary', text: `I kept ${processed.claimsCount} statements from ${processed.name}.` })
        await pause(400)
      }
    }

    if (keptStatements === 0) {
      setWorking(null)
      setFailure(
        'I read your sources but could not extract a single professional statement. That is probably my failure, not yours. Try again, or use a plain text export.',
      )
      return
    }

    push({ kind: 'activity', text: 'Looking at what it all means...' })
    setWorking('Looking at what it all means...')
    const evidenceResult = await callStage('evidence')
    if (!evidenceResult) {
      setWorking(null)
      return
    }
    push({ kind: 'count', text: `Grounded ${evidenceResult.evidenceCreated ?? 0} pieces of evidence.` })
    await pause(500)

    push({ kind: 'activity', text: 'Connecting the dots...' })
    setWorking('Connecting the dots...')
    const capabilitiesResult = await callStage('capabilities')
    if (!capabilitiesResult) {
      setWorking(null)
      return
    }
    push({ kind: 'count', text: `Found ${capabilitiesResult.capabilitiesCount ?? 0} capabilities.` })
    await pause(500)

    setWorking("Noting what I still don't know...")
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

          {working && (
            <div className={styles.workingRow} role="status">
              <StatusDot />
              <span>{working}</span>
            </div>
          )}
        </div>

        {failure && (
          <div className={styles.done}>
            <p className={styles.doneLine}>Something didn&apos;t work.</p>
            <p className={styles.doneDetail}>{failure}</p>
            <p className={styles.doneDetail}>Nothing has been invented to fill the gap.</p>
            <div className={styles.doneCta}>
              <button type="button" className="btn" onClick={() => void run()}>
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
      </main>
    </>
  )
}
