'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './VoiceRecorder.module.css'

interface VoiceRecorderProps {
  /** Demo mode: what the fixture flows pretend was said. */
  fixtureTranscript?: string
  /**
   * Record and transcribe for real. The fixture journey leaves this off and
   * keeps its hold-to-talk mime; a real answer of two minutes is not
   * something anybody should have to hold a button through.
   */
  live?: boolean
  onCapture: (text: string) => void
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'typing'

/** The endpoint gives up past roughly two minutes, so stop before it does. */
const MAX_SECONDS = 110
const WARN_FROM = 20

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

export default function VoiceRecorder({
  fixtureTranscript = '',
  live = false,
  onCapture,
}: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [draft, setDraft] = useState('')
  const [holdHint, setHoldHint] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const releaseMic = () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    recorderRef.current = null
  }

  useEffect(() => {
    return () => {
      clearTimer()
      releaseMic()
    }
  }, [])

  useEffect(() => {
    if (phase === 'typing') textareaRef.current?.focus()
  }, [phase])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setPhase('transcribing')
      const form = new FormData()
      form.append('audio', blob, `answer.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`)
      try {
        const response = await fetch('/api/transcribe', { method: 'POST', body: form })
        const data = (await response.json()) as { text?: string; error?: string }
        if (!response.ok || !data.text) {
          setNotice(data.error ?? "That didn't come back as words. Try again, or type it.")
          setPhase('idle')
          return
        }
        setNotice(null)
        setPhase('idle')
        onCapture(data.text)
      } catch {
        setNotice('No connection to send that to. It is gone — type it instead.')
        setPhase('idle')
      }
    },
    [onCapture],
  )

  const stopLive = useCallback(() => {
    clearTimer()
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }, [])

  const startLive = useCallback(async () => {
    setNotice(null)
    setHoldHint(false)

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setNotice("This browser won't record audio. Type it instead.")
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setNotice('I need permission to use the microphone. Allow it, or type instead.')
      return
    }

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      chunksRef.current = []
      releaseMic()
      if (blob.size < 1200) {
        // A tap rather than an answer.
        setPhase('idle')
        setHoldHint(true)
        return
      }
      void transcribe(blob)
    }

    recorder.start()
    setSeconds(0)
    setPhase('recording')
    startRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000)
      setSeconds(elapsed)
      if (elapsed >= MAX_SECONDS) stopLive()
    }, 250)
  }, [stopLive, transcribe])

  // ── Fixture mode: hold to talk, and a canned transcript comes back ──
  function startFixture() {
    if (phase === 'recording') return
    setHoldHint(false)
    setSeconds(0)
    setPhase('recording')
    startRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
  }

  function stopFixture() {
    if (phase !== 'recording') return
    clearTimer()
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

  const remaining = MAX_SECONDS - seconds
  const micLabel =
    phase === 'recording'
      ? live
        ? `Recording, ${formatTime(seconds)}. Tap to finish.`
        : `Recording, ${formatTime(seconds)}. Release to finish.`
      : live
        ? 'Tap to talk'
        : 'Hold to talk, or press and hold the space key'

  const holdHandlers = live
    ? {
        onClick: () => {
          if (phase === 'recording') stopLive()
          else void startLive()
        },
      }
    : {
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          startFixture()
        },
        onPointerUp: stopFixture,
        onPointerCancel: stopFixture,
        onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
          if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
            event.preventDefault()
            startFixture()
          }
        },
        onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === ' ' || event.key === 'Enter') stopFixture()
        },
      }

  return (
    <div className={styles.wrap}>
      {phase !== 'typing' && (
        <button
          type="button"
          className={phase === 'recording' ? `${styles.mic} ${styles.micRecording}` : styles.mic}
          aria-label={micLabel}
          disabled={phase === 'transcribing'}
          onContextMenu={(event) => event.preventDefault()}
          {...holdHandlers}
        >
          <span className={styles.core} aria-hidden="true">
            {phase === 'recording' && <span className={styles.ring} />}
            <span className={styles.dot} />
          </span>
          {phase === 'recording' ? (
            <>
              <span className={styles.time}>{formatTime(seconds)}</span>
              <span className={styles.listening}>
                {live && remaining <= WARN_FROM ? `${remaining}s left` : 'Listening'}
              </span>
              <span className={styles.wave} aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className={styles.bar} />
                ))}
              </span>
            </>
          ) : phase === 'transcribing' ? (
            <span className={styles.hint}>Writing that down...</span>
          ) : (
            <span className={styles.hint}>{live ? 'Tap to talk' : 'Hold to talk'}</span>
          )}
        </button>
      )}

      {(phase === 'idle' || phase === 'transcribing') && (
        <p className={styles.alt}>
          {notice ? `${notice} ` : holdHint ? (live ? 'That was too short. ' : 'Hold the button a little longer. ') : ''}
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
            <button type="button" className="btn" disabled={!draft.trim()} onClick={sendTyped}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
