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

interface Preferences {
  salaryMin: number | null
  salaryCurrency: string
  workMode: 'onsite' | 'hybrid' | 'remote' | null
  location: string | null
  technologies: string[]
  stages: string[]
}

interface IntentResponse {
  id?: string
  groups?: IntentGroup[]
  listeningFor?: string[]
  structured?: boolean
  preferences?: Preferences
  error?: string
  unconfigured?: boolean
}

const EMPTY_PREFERENCES: Preferences = {
  salaryMin: null,
  salaryCurrency: 'EUR',
  workMode: null,
  location: null,
  technologies: [],
  stages: [],
}

const WORK_MODES: { value: NonNullable<Preferences['workMode']>; label: string }[] = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
]

const STAGE_OPTIONS = ['Pre-seed', 'Seed', 'Series A', 'Scale-up', 'Large company']

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
  const [preferences, setPreferences] = useState<Preferences>(EMPTY_PREFERENCES)
  const [technologyDraft, setTechnologyDraft] = useState('')

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
      setPreferences(data.preferences ?? EMPTY_PREFERENCES)
      setPhase('reveal')
    } catch {
      setError("Your intent couldn't be sent. It is still here — try again.")
      setPhase('ask')
    }
  }

  function togglePreference<K extends 'workMode'>(key: K, value: Preferences[K]) {
    setPreferences((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }))
  }

  function toggleInList(key: 'technologies' | 'stages', value: string) {
    setPreferences((prev) => ({
      ...prev,
      [key]: prev[key].some((item) => item.toLowerCase() === value.toLowerCase())
        ? prev[key].filter((item) => item.toLowerCase() !== value.toLowerCase())
        : [...prev[key], value],
    }))
  }

  function addTechnologies(raw: string) {
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 1)
    if (parts.length === 0) return
    setPreferences((prev) => {
      const existing = new Set(prev.technologies.map((item) => item.toLowerCase()))
      const added = parts.filter((part) => !existing.has(part.toLowerCase()))
      return { ...prev, technologies: [...prev.technologies, ...added].slice(0, 12) }
    })
    setTechnologyDraft('')
  }

  async function confirm() {
    try {
      window.sessionStorage.setItem('amble-listening-activated', '1')
    } catch {
      // Session storage unavailable; the Listening screen still works.
    }

    try {
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      })
    } catch {
      // Best effort, like the confirmation below: the answer itself is
      // already stored, and these can be set again from the Listening screen.
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
                <VoiceRecorder
                  live
                  onCapture={(text) =>
                    setAnswer((previous) => (previous ? `${previous.trim()} ${text}` : text))
                  }
                />
              </div>
            )}

            <p className={styles.hint} role="status">
              Talk if you&apos;d rather. It lands in the box below for you to fix before sending —
              transcription mishears names and numbers.
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

        <section className={styles.prefs} aria-label="What can be checked against an offer">
          <p className="kicker">The checkable part</p>
          <p className={styles.prefsLead}>
            Your words above are what I understand. These are what I can hold an actual offer
            against. Leave anything blank and I won&rsquo;t filter on it.
          </p>

          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pref-salary">
                Worth a conversation from
              </label>
              <div className={styles.fieldRow}>
                <input
                  id="pref-salary"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1000}
                  className={`${styles.input} ${styles.inputNarrow}`}
                  placeholder="65000"
                  value={preferences.salaryMin ?? ''}
                  onChange={(event) =>
                    setPreferences((prev) => ({
                      ...prev,
                      salaryMin: event.target.value === '' ? null : Number(event.target.value),
                    }))
                  }
                />
                <span className={styles.inputSuffix}>
                  {preferences.salaryCurrency} gross a year
                </span>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>How you want to work</span>
              <div className={styles.chips}>
                {WORK_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    className={`${styles.chip} ${preferences.workMode === mode.value ? styles.chipOn : ''}`}
                    aria-pressed={preferences.workMode === mode.value}
                    onClick={() => togglePreference('workMode', mode.value)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pref-location">
                Based in or near
              </label>
              <input
                id="pref-location"
                type="text"
                className={styles.input}
                placeholder="Valencia, or anywhere in Spain"
                value={preferences.location ?? ''}
                onChange={(event) =>
                  setPreferences((prev) => ({ ...prev, location: event.target.value || null }))
                }
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pref-tech">
                Products, stacks or spaces you want to be in
              </label>
              {preferences.technologies.length > 0 && (
                <div className={styles.chips}>
                  {preferences.technologies.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`${styles.chip} ${styles.chipOn}`}
                      aria-label={`Remove ${item}`}
                      onClick={() => toggleInList('technologies', item)}
                    >
                      {item}
                      <span className={styles.chipRemove} aria-hidden="true">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <input
                id="pref-tech"
                type="text"
                className={styles.input}
                placeholder="Developer tools, B2B SaaS, product marketing"
                value={technologyDraft}
                onChange={(event) => setTechnologyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    addTechnologies(technologyDraft)
                  }
                }}
                onBlur={() => addTechnologies(technologyDraft)}
              />
              <span className={styles.fieldHint}>Separate with commas.</span>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Size of company</span>
              <div className={styles.chips}>
                {[
                  ...STAGE_OPTIONS,
                  ...preferences.stages.filter(
                    (stage) =>
                      !STAGE_OPTIONS.some((option) => option.toLowerCase() === stage.toLowerCase()),
                  ),
                ].map((stage) => {
                  const on = preferences.stages.some(
                    (item) => item.toLowerCase() === stage.toLowerCase(),
                  )
                  return (
                    <button
                      key={stage}
                      type="button"
                      className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleInList('stages', stage)}
                    >
                      {stage}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

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
