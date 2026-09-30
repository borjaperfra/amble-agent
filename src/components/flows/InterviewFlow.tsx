'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import SetupProgressView from '@/components/SetupProgressView'
import StatusDot from '@/components/StatusDot'
import VoiceButton from '@/components/VoiceButton'
import { useT } from '@/components/I18nProvider'
import { postJson } from '@/components/api'
import { EvaluationControl } from './EvaluationControl'
import { useDraft } from './useDraft'
import type { SetupProgress } from '@/lib/pipeline/setup'
import styles from '@/app/onboarding/interview/interview.module.css'

interface NextQuestion {
  // WAIT: what they shared is still being read; the questions come from it.
  // UNREADABLE: nothing they shared could be used; they add something else.
  action?: 'ASK' | 'STOP' | 'WAIT' | 'UNREADABLE'
  progress?: SetupProgress
  kind?: 'gap' | 'defence'
  turnId?: string
  question?: string
  reason?: string
  error?: string
}

type Phase = 'loading' | 'waiting' | 'unreadable' | 'ask' | 'sending' | 'complete'

const LOOK_AGAIN_MS = 2500

// Two questions, ready before they are needed: an answer is sent, kept at
// once, and the next question comes back with it. Taking the answer in
// happens afterwards, out of sight. Then what they are looking for.
export default function InterviewFlow({ owner, step: firstStep, steps }: { owner: boolean; step: number; steps: number }) {
  const router = useRouter()
  const t = useT()
  const [phase, setPhase] = useState<Phase>('loading')
  const [current, setCurrent] = useState<NextQuestion | null>(null)
  const [step, setStep] = useState(firstStep)
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  // Kept as they type, per question: a reload does not take away an answer.
  const [answer, setAnswer] = useDraft(current?.turnId ? `answer:${current.turnId}` : null)
  const [showWhy, setShowWhy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const show = useCallback(
    (next: NextQuestion) => {
      if (next.action === 'STOP') {
        setPhase('complete')
        window.setTimeout(() => router.push('/start'), 1600)
        return
      }
      if (next.action === 'UNREADABLE') {
        setProgress(next.progress ?? null)
        setPhase('unreadable')
        return
      }
      if (next.action === 'WAIT') {
        setProgress(next.progress ?? null)
        setPhase('waiting')
        return
      }
      setCurrent(next)
      setShowWhy(false)
      setError(null)
      setPhase('ask')
    },
    [router],
  )

  const load = useCallback(async () => {
    setPhase('loading')
    setError(null)
    const { ok, data } = await postJson<NextQuestion>('/api/interview/next', {})
    if (ok) show(data)
    else setError(t.interview.planFailed)
  }, [show, t])

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
  }, [load])

  // While it reads, it looks again every few seconds.
  useEffect(() => {
    if (phase !== 'waiting') return
    const id = window.setTimeout(async () => {
      const { ok, data } = await postJson<NextQuestion>('/api/interview/next', {})
      if (ok) show(data)
      else setProgress((value) => (value ? { ...value } : value))
    }, LOOK_AGAIN_MS)
    return () => window.clearTimeout(id)
  }, [phase, progress, show])

  // On a computer, straight into the box; on a phone the keyboard would
  // cover the question, so they tap when ready.
  useEffect(() => {
    if (phase === 'ask' && window.matchMedia('(pointer: fine)').matches) textareaRef.current?.focus({ preventScroll: true })
  }, [phase])

  async function submit() {
    if (!current?.turnId || !answer.trim()) return
    setPhase('sending')
    setError(null)
    const { status, data } = await postJson<{ ok?: boolean; next?: NextQuestion }>('/api/interview/answer', { turnId: current.turnId, answer })
    if (!data.ok) {
      // Not kept: it is still in the box, to send again.
      setError(status === 0 ? t.interview.answerUnsent : (data.error ?? t.interview.answerFailed))
      setPhase('ask')
      return
    }
    // Kept for real: the draft of it goes.
    setAnswer('')
    setStep((value) => Math.min(value + 1, steps))
    // Kept. If the next question did not come with it, it is asked for.
    if (data.next) show(data.next)
    else void load()
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
        <p className={styles.counter}>{t.interview.step(Math.min(step, steps), steps)}</p>

        {phase === 'loading' && !error && (
          <div className={styles.stage} role="status">
            <StatusDot />
            <p className={styles.context}>{t.interview.deciding}</p>
          </div>
        )}

        {phase === 'waiting' && progress && (
          <div className={styles.stage}>
            <SetupProgressView progress={progress} />
          </div>
        )}

        {phase === 'unreadable' && (
          <div className={styles.stage}>
            <p className={styles.complete}>{t.interview.unreadableTitle}</p>
            {(progress?.rejected ?? []).map((item) => (
              <p key={item.name} className={styles.context}>
                {t.setup.rejected(item.name, item.reason)}
              </p>
            ))}
            {(progress?.rejected.length ?? 0) === 0 && <p className={styles.context}>{t.interview.unreadableLead}</p>}
            <Link href="/onboarding" className="btn">
              {t.interview.addAnother}
            </Link>
          </div>
        )}

        {phase === 'complete' && (
          <div className={styles.stage} role="status">
            <p className={styles.complete}>{t.interview.completion}</p>
          </div>
        )}

        {(phase === 'ask' || phase === 'sending') && current?.question && (
          <div key={current.turnId} className={`${styles.stage} ${styles.entrance}`}>
            <h1 className={styles.question}>{current.question}</h1>
            {current.kind === 'defence' && <p className={styles.context}>{t.interview.defenceContext}</p>}

            <div className={styles.typingArea}>
              <textarea
                id="interview-answer"
                ref={textareaRef}
                className={styles.answerTextarea}
                value={answer}
                rows={3}
                aria-label={t.interview.answerLabel}
                placeholder={t.common.typePlaceholder}
                disabled={phase === 'sending'}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
                }}
              />
              <div className={styles.answerActions}>
                <VoiceButton
                  disabled={phase === 'sending'}
                  onText={(text) => setAnswer((value) => (value.trim() ? `${value.trim()} ${text}` : text))}
                />
                <button type="button" className={`btn ${styles.send}`} disabled={!answer.trim() || phase === 'sending'} onClick={() => void submit()}>
                  {phase === 'sending' ? t.interview.sending : t.common.send}
                </button>
              </div>
              {error && (
                <p className={styles.errorText} role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className={styles.whyArea}>
              <button type="button" className={`text-btn ${styles.whyToggle}`} aria-expanded={showWhy} onClick={() => setShowWhy((value) => !value)}>
                {t.interview.whyThisQuestion}
              </button>
              {showWhy && current.reason && <p className={styles.whyText}>{current.reason}</p>}
              {/* How good the question was: for the owner, not for the candidate. */}
              {owner && (
                <EvaluationControl
                  targetType="interview_question"
                  targetId={current.turnId ?? ''}
                  label={t.interview.evaluateQuestion}
                  verdicts={['USEFUL', 'REDUNDANT', 'IRRELEVANT']}
                />
              )}
            </div>
          </div>
        )}

        {phase === 'loading' && error && (
          <div className={styles.stage}>
            <p className={styles.errorText} role="alert">
              {error}
            </p>
            <button type="button" className="btn" onClick={() => void load()}>
              {t.common.tryAgain}
            </button>
          </div>
        )}
      </main>
    </>
  )
}
