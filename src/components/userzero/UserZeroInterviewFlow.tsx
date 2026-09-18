'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import VoiceRecorder from '@/components/VoiceRecorder'
import { EvaluationControl } from './EvaluationControl'
import styles from '@/app/onboarding/interview/interview.module.css'

interface Progress {
  asked: number
  expected: number
  remaining: number
  complete: boolean
}

interface NextResponse {
  action?: 'ASK' | 'STOP' | 'WAIT'
  turnId?: string
  question?: string
  reason?: string
  progress?: Progress
  error?: string
  /** The server is backing off after the model failed it. */
  retrying?: boolean
}

interface AnswerResponse {
  ok?: boolean
  next?: NextResponse | null
  progress?: Progress
  error?: string
}

type Phase = 'loading' | 'ask' | 'gotit' | 'complete'
/** What the waiting screen is actually waiting for. */
type Waiting = 'thinking' | 'retrying' | 'offline'

const COMPLETION_LINE = 'I think I understand you pretty well now.'
const VOICE_NOTICE =
  'Talk if you’d rather. It lands in the box for you to fix before sending — transcription mishears names and numbers.'

const WAITING_LINE: Record<Waiting, string> = {
  thinking: 'Deciding what to ask you next.',
  retrying: 'That came back wrong. Trying again — nothing is lost.',
  offline: 'No connection right now. Still trying — nothing is lost.',
}

/** How long to wait before asking again, by how many tries have failed. */
const POLL_MS = 1500
const OFFLINE_BACKOFF_MS = [2000, 4000, 8000, 15000, 30000]

// Plain fetch, no state: the poll loop awaits it before touching state.
async function fetchNextPlan(): Promise<{ data: NextResponse | null; failed?: string }> {
  try {
    const response = await fetch('/api/interview/next', { method: 'POST' })
    const data = (await response.json()) as NextResponse
    if (!response.ok) {
      return { data: null, failed: data.error ?? "Your Rep couldn't plan the next question." }
    }
    return { data }
  } catch {
    return { data: null }
  }
}

export default function UserZeroInterviewFlow() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [turnId, setTurnId] = useState<string | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [showWhy, setShowWhy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [waiting, setWaiting] = useState<Waiting>('thinking')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const finish = useCallback(() => {
    setPhase('complete')
    window.setTimeout(() => router.push('/me'), 1600)
  }, [router])

  const applyPlan = useCallback(
    (data: NextResponse | null, failed?: string) => {
      if (failed || !data) {
        setError(failed ?? "Your Rep couldn't be reached. Nothing has been lost.")
        setPhase('ask')
        return
      }
      if (data.progress) setProgress(data.progress)
      if (data.action === 'STOP') {
        finish()
        return
      }
      setTurnId(data.turnId ?? null)
      setQuestion(data.question ?? null)
      setReason(data.reason ?? null)
      setAnswer('')
      setShowWhy(false)
      setError(null)
      setPhase('ask')
    },
    [finish],
  )

  const loadNext = useCallback(() => {
    setError(null)
    setWaiting('thinking')
    setPhase('loading')
  }, [])

  /**
   * While there is nothing to show, keep asking for it. The server plans on a
   * queue and answers straight away, so this loop is what does the waiting —
   * and it can wait through a tunnel: a request that never arrives is the
   * connection, not a failure, so it backs off and tries again instead of
   * dropping the candidate on an error screen.
   */
  useEffect(() => {
    if (phase !== 'loading') return

    let cancelled = false
    let timer: number | undefined
    let offlineAttempts = 0

    const later = (ms: number) => {
      timer = window.setTimeout(() => {
        if (!cancelled) void tick()
      }, ms)
    }

    async function tick(): Promise<void> {
      const { data, failed } = await fetchNextPlan()
      if (cancelled) return

      if (!data && !failed) {
        // Never reached the server at all.
        setWaiting('offline')
        const backoff =
          OFFLINE_BACKOFF_MS[Math.min(offlineAttempts, OFFLINE_BACKOFF_MS.length - 1)]
        offlineAttempts += 1
        later(backoff)
        return
      }

      offlineAttempts = 0

      if (failed) {
        applyPlan(null, failed)
        return
      }

      if (data?.action === 'WAIT') {
        setWaiting(data.retrying ? 'retrying' : 'thinking')
        later(POLL_MS)
        return
      }

      applyPlan(data)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [phase, applyPlan])

  useEffect(() => {
    if (phase === 'ask') textareaRef.current?.focus()
  }, [phase, question])

  async function submitAnswer() {
    if (!turnId || !answer.trim()) return
    const sent = answer
    // Straight to the acknowledgement: the answer is stored server-side in one
    // write, and the next question was planned while this one was being typed.
    setPhase('gotit')
    setError(null)
    setAnswer('')

    // Sending the same answer twice is safe — the server recognises it as the
    // network stuttering — so a send that never arrives is worth repeating
    // rather than handing back to someone on a moving train.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch('/api/interview/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnId, answer: sent }),
        })
        const data = (await response.json()) as AnswerResponse
        if (!response.ok) {
          setAnswer(sent)
          setError(data.error ?? "Your answer couldn't be saved. It is still here — send it again.")
          setPhase('ask')
          return
        }
        if (data.progress) setProgress(data.progress)

        if (data.next) {
          // Already waiting. Show it after a beat so the acknowledgement reads.
          const next = data.next
          window.setTimeout(() => applyPlan(next), 550)
        } else {
          loadNext()
        }
        return
      } catch {
        if (attempt >= OFFLINE_BACKOFF_MS.length - 1) {
          setAnswer(sent)
          setError("Your answer couldn't be sent. It is still here — try again.")
          setPhase('ask')
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, OFFLINE_BACKOFF_MS[attempt]))
      }
    }
  }

  const asked = progress?.asked ?? 0
  const expected = Math.max(progress?.expected ?? 0, asked)
  const pct = expected > 0 ? Math.min(100, Math.round((asked / expected) * 100)) : 0

  return (
    <>
      <Header
        right={
          <Link href="/me" className="text-btn">
            Save &amp; leave
          </Link>
        }
      />
      <main className={styles.page}>
        {progress && phase !== 'complete' && (
          <div className={styles.progress}>
            <div className={styles.progressTrack} aria-hidden="true">
              <span className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <p className={styles.progressLabel} role="status">
              {progress.remaining > 0
                ? `About ${progress.remaining} more ${progress.remaining === 1 ? 'question' : 'questions'}.`
                : 'Almost done.'}
            </p>
          </div>
        )}

        {phase === 'loading' && (
          <div className={styles.stage} role="status">
            <div className={styles.kickerCenter}>
              <p className="kicker">Your Rep</p>
            </div>
            <StatusDot />
            <p className={styles.context}>{WAITING_LINE[waiting]}</p>
          </div>
        )}

        {phase === 'gotit' && (
          <div className={styles.stage} role="status">
            <p className={styles.gotit}>Got it.</p>
          </div>
        )}

        {phase === 'complete' && (
          <div className={styles.stage} role="status">
            <p className={styles.complete}>{COMPLETION_LINE}</p>
          </div>
        )}

        {phase === 'ask' && question && (
          <div className={`${styles.stage} ${styles.entrance}`}>
            <div className={styles.kickerCenter}>
              <p className="kicker">Your Rep</p>
            </div>
            <h1 className={styles.question}>{question}</h1>

            <div className={styles.answerArea}>
              <textarea
                id="interview-answer"
                ref={textareaRef}
                className={styles.answerTextarea}
                value={answer}
                rows={3}
                placeholder="Write it the way you'd say it."
                aria-label="Your answer"
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitAnswer()
                }}
              />
              <div className={styles.answerActions}>
                <div className={styles.recorderInline}>
                  <VoiceRecorder
                    live
                    onCapture={(text) =>
                      setAnswer((previous) => (previous ? `${previous.trim()} ${text}` : text))
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={!answer.trim()}
                  onClick={() => void submitAnswer()}
                >
                  Send
                </button>
              </div>
              <p className={styles.voiceNotice}>{VOICE_NOTICE}</p>
            </div>

            <div className={styles.whyArea}>
              <button
                type="button"
                className={`text-btn ${styles.whyToggle}`}
                aria-expanded={showWhy}
                onClick={() => setShowWhy((value) => !value)}
              >
                Why this question?
              </button>
              {showWhy && reason && <p className={styles.whyText}>{reason}</p>}
              <EvaluationControl
                targetType="interview_question"
                targetId={turnId ?? ''}
                label="Evaluate this question"
                verdicts={['USEFUL', 'REDUNDANT', 'IRRELEVANT']}
              />
            </div>
          </div>
        )}

        {error && (
          <div className={styles.errorArea}>
            <p className={styles.errorText} role="alert">
              {error}
            </p>
            <button type="button" className="text-btn" onClick={loadNext}>
              Continue →
            </button>
          </div>
        )}
      </main>
    </>
  )
}
