'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/Header'
import TranscriptReview from '@/components/TranscriptReview'
import VoiceRecorder from '@/components/VoiceRecorder'
import { interviewComplete, interviewQuestions } from '@/fixtures/interview'
import styles from '@/app/onboarding/interview/interview.module.css'

type Phase = 'question' | 'leaving' | 'gotit' | 'complete'

export default function FixtureInterviewFlow() {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('question')
  const [captured, setCaptured] = useState<string | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const timeoutsRef = useRef<number[]>([])

  const question = interviewQuestions[index]

  useEffect(() => {
    const timeouts = timeoutsRef.current
    return () => timeouts.forEach((id) => window.clearTimeout(id))
  }, [])

  function schedule(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms)
    timeoutsRef.current.push(id)
  }

  function keepAnswer() {
    setCaptured(null)
    setShowWhy(false)
    setPhase('leaving')
    schedule(() => setPhase('gotit'), 340)
    schedule(() => {
      if (index + 1 < interviewQuestions.length) {
        setIndex(index + 1)
        setPhase('question')
      } else {
        setPhase('complete')
        schedule(() => router.push('/me'), 2100)
      }
    }, 1050)
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
        {phase === 'gotit' ? (
          <div className={styles.stage} role="status">
            <p className={styles.gotit}>Got it.</p>
          </div>
        ) : phase === 'complete' ? (
          <div className={styles.stage} role="status">
            <p className={styles.complete}>{interviewComplete}</p>
          </div>
        ) : (
          <div
            key={question.id}
            className={`${styles.stage} ${styles.entrance} ${phase === 'leaving' ? styles.stageLeaving : ''}`}
          >
            <div className={styles.kickerCenter}>
              <p className="kicker">Your Rep</p>
            </div>
            <p className={styles.context}>{question.context}</p>
            <h1 className={styles.question}>{question.question}</h1>

            {captured === null ? (
              <>
                <div className={styles.recorderArea}>
                  <VoiceRecorder
                    fixtureTranscript={question.fixtureTranscript}
                    onCapture={setCaptured}
                  />
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
                  {showWhy && <p className={styles.whyText}>{question.why}</p>}
                </div>
              </>
            ) : (
              <TranscriptReview
                value={captured}
                onChange={setCaptured}
                onKeep={keepAnswer}
                onDiscard={() => setCaptured(null)}
              />
            )}
          </div>
        )}

        {phase !== 'complete' && (
          <p className={styles.counter} aria-hidden="true">
            {index + 1} of {interviewQuestions.length}
          </p>
        )}
      </main>
    </>
  )
}
