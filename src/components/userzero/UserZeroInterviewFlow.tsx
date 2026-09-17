'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import VoiceRecorder from '@/components/VoiceRecorder'
import { EvaluationControl } from './EvaluationControl'
import styles from '@/app/onboarding/interview/interview.module.css'

interface NextResponse {
  action?: 'ASK' | 'STOP'
  turnId?: string
  question?: string
  reason?: string
  error?: string
}

interface AnswerResponse {
  ok?: boolean
  error?: string
}

type Phase = 'loading' | 'ask' | 'answering' | 'gotit' | 'complete'

const COMPLETION_LINE = 'I think I understand you pretty well now.'
const VOICE_NOTICE =
  "Voice is simulated in this build — it doesn't transcribe. Use the text box below."

export default function UserZeroInterviewFlow() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [turnId, setTurnId] = useState<string | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [showWhy, setShowWhy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const applyPlan = useCallback(
    (data: NextResponse | null, failed?: string) => {
      if (failed || !data) {
        setError(failed ?? "Your Rep couldn't be reached. Nothing has been lost.")
        setPhase('ask')
        return
      }
      if (data.action === 'STOP') {
        setPhase('complete')
        window.setTimeout(() => router.push('/me'), 2100)
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
    [router],
  )

  const loadNext = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const response = await fetch('/api/interview/next', { method: 'POST' })
      const data = (await response.json()) as NextResponse
      if (!response.ok) {
        setError(data.error ?? "Your Rep couldn't plan the next question.")
        return
      }
      applyPlan(data)
    } catch {
      setError("Your Rep couldn't be reached. Nothing has been lost.")
      setPhase('ask')
      setQuestion((current) => current)
    }
  }, [applyPlan])

  useEffect(() => {
    const id = window.setTimeout(() => void loadNext(), 0)
    return () => window.clearTimeout(id)
  }, [loadNext])

  useEffect(() => {
    if (phase === 'ask') textareaRef.current?.focus()
  }, [phase])

  async function loadNextAfterAnswer() {
    setPhase('gotit')
    const startedAt = Date.now()
    let data: NextResponse | null = null
    let failure: string | undefined
    try {
      const response = await fetch('/api/interview/next', { method: 'POST' })
      data = (await response.json()) as NextResponse
      if (!response.ok) {
        failure = data.error ?? "Your Rep couldn't plan the next question."
        data = null
      }
    } catch {
      failure = "Your Rep couldn't be reached. Nothing has been lost."
    }
    const wait = Math.max(0, 800 - (Date.now() - startedAt))
    window.setTimeout(() => {
      if (failure) {
        setError(failure)
        setPhase('ask')
      } else {
        applyPlan(data)
      }
    }, wait)
  }

  async function submitAnswer() {
    if (!turnId || !answer.trim()) return
    setPhase('answering')
    setError(null)
    try {
      const response = await fetch('/api/interview/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, answer }),
      })
      const data = (await response.json()) as AnswerResponse
      if (!response.ok) {
        setError(
          data.error ??
            "Your answer couldn't be incorporated. It is still here — send it again.",
        )
        setPhase('ask')
        return
      }
      void loadNextAfterAnswer()
    } catch {
      setError("Your answer couldn't be sent. It is still here — try again.")
      setPhase('ask')
    }
  }

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

        {(phase === 'ask' || phase === 'answering') && question && (
          <div className={`${styles.stage} ${styles.entrance}`}>
            <div className={styles.kickerCenter}>
              <p className="kicker">Your Rep</p>
            </div>
            <h1 className={styles.question}>{question}</h1>

            <div className={styles.recorderArea}>
              <VoiceRecorder fixtureTranscript="" onCapture={() => undefined} />
            </div>

            <p className={styles.voiceNotice}>{VOICE_NOTICE}</p>

            <div className={styles.typingArea}>
              <label className={styles.typeLabel} htmlFor="interview-answer">
                or type
              </label>
              <textarea
                id="interview-answer"
                ref={textareaRef}
                className={styles.answerTextarea}
                value={answer}
                rows={4}
                placeholder="Take your time. Write it the way you'd say it."
                disabled={phase === 'answering'}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submitAnswer()
                }}
              />
              <div className={styles.answerActions}>
                <button
                  type="button"
                  className="btn"
                  disabled={!answer.trim() || phase === 'answering'}
                  onClick={() => void submitAnswer()}
                >
                  {phase === 'answering' ? 'Listening to your answer…' : 'Send'}
                </button>
              </div>
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
