'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import InlineEdit from '@/components/InlineEdit'
import StatusDot from '@/components/StatusDot'
import VoiceRecorder from '@/components/VoiceRecorder'
import { useT } from '@/components/I18nProvider'
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

export default function IntentFlow() {
  const router = useRouter()
  const t = useT()
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
        setError(data.error ?? t.intent.interpretFailed)
        setPhase('ask')
        return
      }
      setResult(data)
      setEditedGroups(data.groups ?? [])
      setPhase('reveal')
    } catch {
      setError(t.intent.unsent)
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
            <p className="kicker">{t.common.yourRep}</p>
            <p className={styles.lead}>{t.intent.lead}</p>
            <h1 className={styles.question}>{t.intent.question}</h1>

            {phase === 'sending' && (
              <div className={styles.workingArea} role="status">
                <StatusDot />
                <span>{t.intent.reading}</span>
              </div>
            )}

            {phase !== 'sending' && (
              <div className={styles.recorderArea}>
                <VoiceRecorder fixtureTranscript="" onCapture={() => undefined} />
              </div>
            )}

            <p className={styles.hint} role="status">
              {t.intent.voiceNotice}
            </p>

            <div className={styles.typingAreaIntent}>
              <label className={styles.groupLabel} htmlFor="intent-answer">
                {t.common.orType}
              </label>
              <textarea
                id="intent-answer"
                className={styles.answerTextarea}
                value={answer}
                rows={5}
                placeholder={t.intent.placeholder}
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
                  {phase === 'sending' ? t.intent.reading : t.common.send}
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
          <p className="kicker">{t.common.yourRep}</p>
          <h1 className={styles.revealLead}>{t.intent.revealLead}</h1>
          {result && !result.structured && (
            <p className={styles.hint}>
              {t.intent.unstructured}
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
                      label={t.intent.valueLabel(group.label)}
                      onChange={(next) => updateValue(groupIndex, valueIndex, next)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={styles.confirm}>
          <p className={styles.confirmQuestion}>{t.intent.confirmQuestion}</p>
          <div className={styles.confirmActions}>
            <button type="button" className="btn" onClick={() => void confirm()}>
              {t.intent.confirm}
            </button>
            <button
              type="button"
              className="text-btn"
              aria-expanded={hint}
              onClick={() => setHint(true)}
            >
              {t.intent.somethingWrong}
            </button>
            {hint && (
              <p className={styles.hint}>
                {t.intent.changeHint}
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
