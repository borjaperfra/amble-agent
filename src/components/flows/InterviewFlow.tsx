'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import StatusDot from '@/components/StatusDot'
import VoiceRecorder from '@/components/VoiceRecorder'
import { useT } from '@/components/I18nProvider'
import { EvaluationControl } from './EvaluationControl'
import styles from '@/app/onboarding/interview/interview.module.css'

interface NextResponse {
  action?: 'ASK' | 'STOP'
  kind?: 'gap' | 'defence'
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

export default function InterviewFlow() {
  const router = useRouter()
  const t = useT()
  const [phase, setPhase] = useState<Phase>('loading')
  const [turnId, setTurnId] = useState<string | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [isDefence, setIsDefence] = useState(false)
  const [answer, setAnswer] = useState('')
  const [showWhy, setShowWhy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const applyPlan = useCallback(
    (data: NextResponse | null, failed?: string) => {
      if (failed || !data) {
        setError(failed ?? t.common.unreachable)
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
      setIsDefence(data.kind === 'defence')
      setAnswer('')
      setShowWhy(false)
      setError(null)
      setPhase('ask')
    },
    [router, t],
  )

  const loadNext = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const response = await fetch('/api/interview/next', { method: 'POST' })
      const data = (await response.json()) as NextResponse
      if (!response.ok) {
        setError(data.error ?? t.interview.planFailed)
        return
      }
      applyPlan(data)
    } catch {
      setError(t.common.unreachable)
      setPhase('ask')
      setQuestion((current) => current)
    }
  }, [applyPlan, t])

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
        failure = data.error ?? t.interview.planFailed
        data = null
      }
    } catch {
      failure = t.common.unreachable
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
        setError(data.error ?? t.interview.answerFailed)
        setPhase('ask')
        return
      }
      void loadNextAfterAnswer()
    } catch {
      setError(t.interview.answerUnsent)
      setPhase('ask')
    }
  }

  return (
    <>
      <Header
        right={
          <Link href="/me" className="text-btn">
            {t.interview.saveAndLeave}
          </Link>
        }
      />
      <main className={styles.page}>
        {phase === 'loading' && (
          <div className={styles.stage} role="status">
            <div className={styles.kickerCenter}>
              <p className="kicker rep-kicker">
              <Symbol size={20} /> {t.common.yourRep}
            </p>
            </div>
            <StatusDot />
            <p className={styles.context}>{t.interview.deciding}</p>
          </div>
        )}

        {phase === 'gotit' && (
          <div className={styles.stage} role="status">
            <p className={styles.gotit}>{t.interview.gotIt}</p>
            <div className={styles.workingArea}>
              <StatusDot />
              <span>{t.interview.thinking}</span>
            </div>
          </div>
        )}

        {phase === 'complete' && (
          <div className={styles.stage} role="status">
            <p className={styles.complete}>{t.interview.completion}</p>
          </div>
        )}

        {(phase === 'ask' || phase === 'answering') && question && (
          <div className={`${styles.stage} ${styles.entrance}`}>
            <div className={styles.kickerCenter}>
              <p className="kicker rep-kicker">
              <Symbol size={20} /> {t.common.yourRep}
            </p>
            </div>
            <h1 className={styles.question}>{question}</h1>
            {isDefence && <p className={styles.context}>{t.interview.defenceContext}</p>}

            {phase === 'answering' ? (
              <div className={styles.workingArea} role="status">
                <StatusDot />
                <span>{t.interview.updating}</span>
              </div>
            ) : (
              <>
                <div className={styles.recorderArea}>
                  <VoiceRecorder fixtureTranscript="" onCapture={() => undefined} />
                </div>

                <p className={styles.voiceNotice}>{t.interview.voiceNotice}</p>
              </>
            )}

            <div className={styles.typingArea}>
              <label className={styles.typeLabel} htmlFor="interview-answer">
                {t.common.orType}
              </label>
              <textarea
                id="interview-answer"
                ref={textareaRef}
                className={styles.answerTextarea}
                value={answer}
                rows={4}
                placeholder={t.common.typePlaceholder}
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
                  {phase === 'answering' ? t.interview.sending : t.common.send}
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
                {t.interview.whyThisQuestion}
              </button>
              {showWhy && reason && <p className={styles.whyText}>{reason}</p>}
              <EvaluationControl
                targetType="interview_question"
                targetId={turnId ?? ''}
                label={t.interview.evaluateQuestion}
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
              {t.common.continue}
            </button>
          </div>
        )}
      </main>
    </>
  )
}
