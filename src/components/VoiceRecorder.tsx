'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './VoiceRecorder.module.css'

interface VoiceRecorderProps {
  fixtureTranscript: string
  onCapture: (text: string) => void
}

type Phase = 'idle' | 'recording' | 'typing'

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function VoiceRecorder({ fixtureTranscript, onCapture }: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [draft, setDraft] = useState('')
  const [holdHint, setHoldHint] = useState(false)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (phase === 'typing') textareaRef.current?.focus()
  }, [phase])

  function start() {
    if (phase === 'recording') return
    setHoldHint(false)
    setSeconds(0)
    setPhase('recording')
    startRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
  }

  function stop() {
    if (phase !== 'recording') return
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const held = Date.now() - startRef.current
    setPhase('idle')
    if (held >= 600) {
      onCapture(fixtureTranscript)
    } else {
      setHoldHint(true)
    }
  }

  function beginTyping() {
    setPhase('typing')
  }

  function sendTyped() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setPhase('idle')
    onCapture(text)
  }

  function cancelTyping() {
    setDraft('')
    setPhase('idle')
  }

  return (
    <div className={styles.wrap}>
      {phase !== 'typing' && (
        <button
          type="button"
          className={
            phase === 'recording' ? `${styles.mic} ${styles.micRecording}` : styles.mic
          }
          aria-label={
            phase === 'recording'
              ? `Recording, ${formatTime(seconds)}. Release to finish.`
              : 'Hold to talk, or press and hold the space key'
          }
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            start()
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
          onKeyDown={(event) => {
            if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
              event.preventDefault()
              start()
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') stop()
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className={styles.core} aria-hidden="true">
            {phase === 'recording' && <span className={styles.ring} />}
            <span className={styles.dot} />
          </span>
          {phase === 'recording' ? (
            <>
              <span className={styles.time}>{formatTime(seconds)}</span>
              <span className={styles.listening}>Listening</span>
              <span className={styles.wave} aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className={styles.bar} />
                ))}
              </span>
            </>
          ) : (
            <span className={styles.hint}>Hold to talk</span>
          )}
        </button>
      )}

      {phase === 'idle' && (
        <p className={styles.alt}>
          {holdHint ? 'Hold the button a little longer. ' : ''}
          <button type="button" className={styles.altBtn} onClick={beginTyping}>
            or type
          </button>
        </p>
      )}

      {phase === 'typing' && (
        <div className={styles.typing}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={draft}
            rows={4}
            placeholder="Take your time. Write it the way you'd say it."
            aria-label="Type your answer"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendTyped()
            }}
          />
          <div className={styles.typingActions}>
            <button type="button" className="text-btn" onClick={cancelTyping}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              disabled={!draft.trim()}
              onClick={sendTyped}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
