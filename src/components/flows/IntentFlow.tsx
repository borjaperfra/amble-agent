'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import InlineEdit from '@/components/InlineEdit'
import StatusDot from '@/components/StatusDot'
import VoiceButton from '@/components/VoiceButton'
import { useT } from '@/components/I18nProvider'
import { useDraft } from './useDraft'
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

export default function IntentFlow({ setupStep }: { setupStep: { current: number; total: number } | null }) {
  const router = useRouter()
  const t = useT()
  const [phase, setPhase] = useState<Phase>('ask')
  // Kept as they type: a reload does not take away what they wrote.
  const [answer, setAnswer, clearDraft] = useDraft('intent')
  const [result, setResult] = useState<IntentResponse | null>(null)
  const [editedGroups, setEditedGroups] = useState<IntentGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // The groups come with fixed English labels; they are shown in their language.
  const labelOf = (label: string) => (t.intent.labels as Record<string, string>)[label] ?? label

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
    setConfirming(true)
    setError(null)
    try {
      window.sessionStorage.setItem('amble-listening-activated', '1')
    } catch {
      // Session storage unavailable; the Listening screen still works.
    }
    if (result?.id) {
      try {
        const response = await fetch('/api/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', intentId: result.id, groups: editedGroups }),
        })
        if (!response.ok) throw new Error()
      } catch {
        // Not confirmed: they stay here, with what they wrote, to try again.
        setError(t.intent.confirmFailed)
        setConfirming(false)
        return
      }
    }
    clearDraft()
    router.push('/start')
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
            {setupStep && <p className={styles.step}>{t.interview.step(setupStep.current, setupStep.total)}</p>}
            <p className={styles.lead}>{setupStep ? t.intent.leadSetup : t.intent.lead}</p>
            <h1 className={styles.question}>{t.intent.question}</h1>

            {phase === 'sending' && (
              <div className={styles.workingArea} role="status">
                <StatusDot />
                <span>{t.intent.reading}</span>
              </div>
            )}

            <div className={styles.typingAreaIntent}>
              <textarea
                id="intent-answer"
                className={styles.answerTextarea}
                value={answer}
                rows={4}
                aria-label={t.intent.question}
                placeholder={t.intent.placeholder}
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
                <button
                  type="button"
                  className={`btn ${styles.send}`}
                  disabled={!answer.trim() || phase === 'sending'}
                  onClick={() => void submit()}
                >
                  {phase === 'sending' ? t.interview.sending : t.common.send}
                </button>
              </div>
            </div>

            {error && (
              <p className={styles.error} role="alert">
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
          <h1 className={styles.revealLead}>{t.intent.revealLead}</h1>
          {result && !result.structured && (
            <>
              <p className={styles.hint}>{t.intent.unstructured}</p>
              {/* Their words are still in the box: the same answer, read again. */}
              <button type="button" className="text-btn" disabled={confirming} onClick={() => void submit()}>
                {t.intent.retryReading}
              </button>
            </>
          )}
        </div>

        <div className={styles.groups}>
          {editedGroups.map((group, groupIndex) => (
            <section
              key={`${group.label}-${groupIndex}`}
              className={styles.group}
              style={{ animationDelay: `${120 + groupIndex * 90}ms` }}
              aria-label={labelOf(group.label)}
            >
              <h2 className={styles.groupLabel}>{labelOf(group.label)}</h2>
              <div className={styles.values}>
                {group.values.map((value, valueIndex) => (
                  <div key={`${groupIndex}-${valueIndex}`} className={styles.value}>
                    <InlineEdit
                      value={value}
                      label={t.intent.valueLabel(labelOf(group.label))}
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
            <button type="button" className="btn" disabled={confirming} onClick={() => void confirm()}>
              {confirming ? t.intent.confirming : t.intent.confirm}
            </button>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
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
