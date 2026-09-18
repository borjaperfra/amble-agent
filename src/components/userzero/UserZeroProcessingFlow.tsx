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

interface SourceState {
  id: string
  name: string
  type: string
  status: string
  detail: string | null
  claims: number
  discoveries: { title: string; meta: string }[]
}

interface StateResponse {
  phase?: 'idle' | 'reading' | 'connecting' | 'done' | 'failed'
  sources?: SourceState[]
  counts?: { claims: number; evidence: number; capabilities: number; uncertainties: number }
  queue?: { busy: boolean; retrying: boolean; nextAttemptAt: string | null }
  error?: string | null
}

type Stage = 'starting' | 'reading' | 'connecting' | 'retrying' | 'offline' | 'done' | 'failed'

const POLL_MS = 1200
const OFFLINE_BACKOFF_MS = [2000, 4000, 8000, 15000, 30000]

export default function UserZeroProcessingFlow() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [stage, setStage] = useState<Stage>('starting')
  const [readingNow, setReadingNow] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const seenRef = useRef<Set<string>>(new Set())

  /**
   * The reading happens on a queue, so the screen is not a transcript of one
   * long request any more: it asks the server what it knows and shows
   * whatever is new. Lock the phone, lose signal, reload the page — the story
   * picks up where it was rather than starting over or dying.
   */
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let offlineAttempts = 0

    const later = (ms: number) => {
      timer = window.setTimeout(() => {
        if (!cancelled) void poll()
      }, ms)
    }

    function absorb(data: StateResponse): void {
      const seen = seenRef.current
      const fresh: LogEntry[] = []

      for (const source of data.sources ?? []) {
        if (source.status !== 'processed') continue
        source.discoveries.forEach((discovery, index) => {
          const key = `${source.id}-d${index}`
          if (seen.has(key)) return
          seen.add(key)
          fresh.push({ key, kind: 'discovery', title: discovery.title, meta: discovery.meta })
        })
        const summaryKey = `${source.id}-kept`
        if (!seen.has(summaryKey)) {
          seen.add(summaryKey)
          fresh.push({
            key: summaryKey,
            kind: 'summary',
            text: `I kept ${source.claims} statements from ${source.name}.`,
          })
        }
      }

      const counts = data.counts
      if (counts && counts.evidence > 0 && !seen.has('evidence')) {
        seen.add('evidence')
        fresh.push({
          key: 'evidence',
          kind: 'count',
          text: `Grounded ${counts.evidence} pieces of evidence.`,
        })
      }
      if (counts && counts.capabilities > 0 && !seen.has('capabilities')) {
        seen.add('capabilities')
        fresh.push({
          key: 'capabilities',
          kind: 'count',
          text: `Found ${counts.capabilities} capabilities.`,
        })
      }

      if (fresh.length > 0) setEntries((prev) => [...prev, ...fresh])

      const next = (data.sources ?? []).find((source) => source.status === 'extracted')
      setReadingNow(next?.name ?? null)
    }

    async function poll(): Promise<void> {
      let data: StateResponse
      try {
        const response = await fetch('/api/onboarding/state')
        data = (await response.json()) as StateResponse
        if (!response.ok) {
          if (cancelled) return
          setFailure(data.error ?? 'Processing failed.')
          setStage('failed')
          return
        }
      } catch {
        if (cancelled) return
        // Never reached the server. The work carries on without us.
        setStage('offline')
        const backoff =
          OFFLINE_BACKOFF_MS[Math.min(offlineAttempts, OFFLINE_BACKOFF_MS.length - 1)]
        offlineAttempts += 1
        later(backoff)
        return
      }

      if (cancelled) return
      offlineAttempts = 0
      absorb(data)

      if (data.phase === 'done') {
        setStage('done')
        return
      }
      if (data.phase === 'failed') {
        setFailure(data.error ?? 'Processing failed.')
        setStage('failed')
        return
      }
      setStage(data.queue?.retrying ? 'retrying' : data.phase === 'connecting' ? 'connecting' : 'reading')
      later(POLL_MS)
    }

    async function start(): Promise<void> {
      try {
        const response = await fetch('/api/onboarding/process', { method: 'POST' })
        if (!response.ok) {
          const data = (await response.json()) as { error?: string }
          // Work already queued from an earlier visit is not a failure: the
          // poll below will find it.
          if (!cancelled && !data.error?.includes('no unread sources')) {
            setFailure(data.error ?? 'Processing could not be started.')
            setStage('failed')
            return
          }
        }
      } catch {
        // Could not even ask. The poll will keep trying.
      }
      if (!cancelled) void poll()
    }

    void start()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [attempt])

  const working =
    stage === 'offline'
      ? 'No connection. Your Rep keeps reading — still trying to hear back.'
      : stage === 'retrying'
        ? 'That came back wrong. Trying again — nothing is lost.'
        : stage === 'connecting'
          ? 'Connecting the dots...'
          : stage === 'reading' || stage === 'starting'
            ? readingNow
              ? `Reading ${readingNow}...`
              : 'Looking at what it all means...'
            : null

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

        {stage === 'failed' && (
          <div className={styles.done}>
            <p className={styles.doneLine}>Something didn&apos;t work.</p>
            <p className={styles.doneDetail}>{failure}</p>
            <p className={styles.doneDetail}>Nothing has been invented to fill the gap.</p>
            <div className={styles.doneCta}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFailure(null)
                  setStage('starting')
                  setAttempt((value) => value + 1)
                }}
              >
                Try again →
              </button>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className={styles.done}>
            <p className={styles.doneLine}>I have the basics.</p>
            <p className={styles.doneDetail}>
              {'There are a few things\nI’d rather ask you myself.'}
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
