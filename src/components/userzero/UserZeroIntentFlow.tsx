'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import InlineEdit from '@/components/InlineEdit'
import StatusDot from '@/components/StatusDot'
import VoiceRecorder from '@/components/VoiceRecorder'
import styles from '@/app/me/intent/intent.module.css'

interface IntentGroup {
  label: string
  values: string[]
}

interface IntentResponse {
  id?: string
  groups?: IntentGroup[]
  listeningFor?: string[]
  structured?: boolean
  error?: string
  unconfigured?: boolean
}

type Phase = 'ask' | 'sending' | 'reveal'

const PROMPT_LEAD = 'One more thing.'
const PROMPT_QUESTION =
  'What would have to be true for you to seriously consider leaving your current job?'

export default function UserZeroIntentFlow() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('ask')
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<IntentResponse | null>(null)
  const [editedGroups, setEditedGroups] = useState<IntentGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState(false)

  async function submit() {
    if (!answer.trim()) return
    setPhase('sending')
    setError(null)
    try {
      const response = await fetch('/api/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      })
      const data = (await response.json()) as IntentResponse
      if (!response.ok) {
        setError(data.error ?? "Your intent couldn't be interpreted.")
        setPhase('ask')
        return
      }
      setResult(data)
      setEditedGroups(data.groups ?? [])
      setPhase('reveal')
    } catch {
      setError("Your intent couldn't be sent. It is still here — try again.")
      setPhase('ask')
    }
  }

  async function confirm() {
    try {
      window.sessionStorage.setItem('amble-listening-activated', '1')
    } catch {
      // Session storage unavailable; the Listening screen still works.
    }
    if (result?.id) {
      try {
        await fetch('/api/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', intentId: result.id }),
        })
      } catch {
        // Confirmation persistence is best-effort in this build.
      }
    }
    router.push('/listening')
  }

  function updateValue(groupIndex: number, valueIndex: number, value: string) {
    setEditedGroups((prev) =>
      prev.map((group, gi) =>
        gi === groupIndex
          ? { ...group, values: group.values.map((v, vi) => (vi === valueIndex ? value : v)) }
          : group,
      ),
    )
  }

  if (phase === 'ask' || phase === 'sending') {
    return (
      <>
        <Header />
        <main className={styles.page}>
          <div className={styles.ask}>
            <p className="kicker">Your Rep</p>
            <p className={styles.lead}>{PROMPT_LEAD}</p>
            <h1 className={styles.question}>{PROMPT_QUESTION}</h1>

            {phase === 'sending' && (
              <div className={styles.workingArea} role="status">
                <StatusDot />
                <span>Reading what matters to you...</span>
              </div>
            )}

            {phase !== 'sending' && (
              <div className={styles.recorderArea}>
                <VoiceRecorder fixtureTranscript="" onCapture={() => undefined} />
              </div>
            )}

            <p className={styles.hint} role="status">
              Voice is simulated in this build — it doesn&apos;t transcribe. Use the text box
              below.
            </p>

            <div className={styles.typingAreaIntent}>
              <label className={styles.groupLabel} htmlFor="intent-answer">
                or type
              </label>
              <textarea
                id="intent-answer"
                className={styles.answerTextarea}
                value={answer}
                rows={5}
                placeholder="Say it however it comes out. Your Rep will structure it."
                disabled={phase === 'sending'}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
                }}
              />
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className="btn"
                  disabled={!answer.trim() || phase === 'sending'}
                  onClick={() => void submit()}
                >
                  {phase === 'sending' ? 'Reading what matters to you…' : 'Send'}
                </button>
              </div>
            </div>

            {error && (
              <p className={styles.hint} role="alert">
                {error}
              </p>
            )}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <div className={styles.reveal}>
          <p className="kicker">Your Rep</p>
          <h1 className={styles.revealLead}>&quot;Here&apos;s what I&apos;ll listen for.&quot;</h1>
          {result && !result.structured && (
            <p className={styles.hint}>
              I couldn&apos;t structure this automatically, so your words are kept exactly. Edit
              anything below.
            </p>
          )}
        </div>

        <div className={styles.groups}>
          {editedGroups.map((group, groupIndex) => (
            <section
              key={`${group.label}-${groupIndex}`}
              className={styles.group}
              style={{ animationDelay: `${120 + groupIndex * 90}ms` }}
              aria-label={group.label}
            >
              <h2 className={styles.groupLabel}>{group.label}</h2>
              <div className={styles.values}>
                {group.values.map((value, valueIndex) => (
                  <div key={`${groupIndex}-${valueIndex}`} className={styles.value}>
                    <InlineEdit
                      value={value}
                      label={`${group.label} value`}
                      onChange={(next) => updateValue(groupIndex, valueIndex, next)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={styles.confirm}>
          <p className={styles.confirmQuestion}>Does this represent you?</p>
          <div className={styles.confirmActions}>
            <button type="button" className="btn" onClick={() => void confirm()}>
              Yes, start listening
            </button>
            <button
              type="button"
              className="text-btn"
              aria-expanded={hint}
              onClick={() => setHint(true)}
            >
              Something isn&apos;t right
            </button>
            {hint && (
              <p className={styles.hint}>
                Change anything above. Your Rep listens for exactly what you leave here with.
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
