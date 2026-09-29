'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/components/I18nProvider'
import styles from './VoiceButton.module.css'

// Speaking an answer: tap to start, tap to stop. What was said comes back as
// text into the answer box, for them to read over before sending. Two
// minutes at most, what the transcription takes in one go.

const MAX_SECONDS = 120

type State = 'idle' | 'recording' | 'transcribing'

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export default function VoiceButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const v = useT().voice
  const [state, setState] = useState<State>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current)
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  async function start() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(v.unsupported)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data)
      }
      media.onstop = () => void send(new Blob(chunks.current, { type: media.mimeType || mime || 'audio/webm' }))
      media.start()
      recorder.current = media
      setSeconds(0)
      setState('recording')
      timer.current = window.setInterval(() => {
        setSeconds((value) => {
          if (value + 1 >= MAX_SECONDS) stop()
          return value + 1
        })
      }, 1000)
    } catch {
      setError(v.denied)
    }
  }

  function stop() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    const media = recorder.current
    if (media && media.state !== 'inactive') {
      media.stop()
      media.stream.getTracks().forEach((track) => track.stop())
    }
  }

  async function send(audio: Blob) {
    setState('transcribing')
    try {
      const form = new FormData()
      form.append('audio', audio)
      const response = await fetch('/api/transcribe', { method: 'POST', body: form })
      const data = (await response.json()) as { text?: string }
      if (!response.ok || !data.text) throw new Error()
      onText(data.text)
    } catch {
      setError(v.failed)
    } finally {
      setState('idle')
    }
  }

  const label = state === 'recording' ? v.stop : state === 'transcribing' ? v.transcribing : v.start
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${styles.button} ${state === 'recording' ? styles.recording : ''}`}
        onClick={() => (state === 'recording' ? stop() : void start())}
        disabled={disabled || state === 'transcribing'}
        aria-label={label}
        title={label}
      >
        {state === 'recording' ? (
          <span className={styles.stopIcon} aria-hidden="true" />
        ) : state === 'transcribing' ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3ZM6 11a6 6 0 0 0 12 0M12 17v3.5"
            />
          </svg>
        )}
      </button>
      {state === 'recording' && <span className={styles.clock}>{clock}</span>}
      {state === 'transcribing' && <span className={styles.clock}>{v.transcribing}</span>}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
