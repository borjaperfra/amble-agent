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
  action?: 'ASK' | 'STOP'
  turnId?: string
  question?: string
  reason?: string
  progress?: Progress
  error?: string
}

interface AnswerResponse {
  ok?: boolean
  next?: NextResponse | null
  progress?: Progress
  error?: string
}

type Phase = 'loading' | 'ask' | 'gotit' | 'complete'

const COMPLETION_LINE = 'I think I understand you pretty well now.'
const VOICE_NOTICE =
  "Voice is simulated in this build — it doesn't transcribe. Use the text box below."

// Plain fetch, no state: the mount effect awaits it before touching state, and
// the event handlers reuse it through loadNext().
async function fetchNextPlan(): Promise<{ data: NextResponse | null; failed?: string }> {
  try {
    const response = await fetch('/api/interview/next', { method: 'POST' })
    const data = (await response.json()) as NextResponse
    if (!response.ok) {
      return { data: null, failed: data.error ?? "Your Rep couldn't plan the next question." }
    }
    return { data }
  } catch {
    return { data: null, failed: "Your Rep couldn't be reached. Nothing has been lost." }
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

  const loadNext = useCallback(async () => {
    setPhase('loading')
    setError(null)
    const { data, failed } = await fetchNextPlan()
    applyPlan(data, failed)
  }, [applyPlan])

  // First question. The phase already starts at 'loading', so nothing is set
  // before the fetch resolves, and a plan that lands after unmount is dropped.
  useEffect(() => {
    let cancelled = false
    async function loadFirst() {
      const { data, failed } = await fetchNextPlan()
      if (!cancelled) applyPlan(data, failed)
    }
    void loadFirst()
    return () => {
      cancelled = true
    }
  }, [applyPlan])

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
        window.setTimeout(() => applyPlan(data.next ?? null), 550)
      } else {
        void loadNext()
      }
    } catch {
      setAnswer(sent)
      setError("Your answer couldn't be sent. It is still here — try again.")
      setPhase('ask')
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
            <p className={styles.context}>Deciding what to ask you next.</p>
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
                  <VoiceRecorder fixtureTranscript="" onCapture={() => undefined} />
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
            <button type="button" className="text-btn" onClick={() => void loadNext()}>
              Continue →
            </button>
          </div>
        )}
      </main>
    </>
  )
}
