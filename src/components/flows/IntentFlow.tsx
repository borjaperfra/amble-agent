'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import InlineEdit from '@/components/InlineEdit'
import StatusDot from '@/components/StatusDot'
import VoiceButton from '@/components/VoiceButton'
import { useI18n, useT } from '@/components/I18nProvider'
import { postJson } from '@/components/api'
import { useDraft } from './useDraft'
import { INTENT_CORE, INTENT_ORDER, type IntentCore } from '@/lib/intent-order'
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

// The rows shown, in this order. Pay, where and the role are always there:
// one not said is shown as such, with a place to say it, since without them
// the Rep shows offers it cannot rule out.
const ORDER = INTENT_ORDER
const CORE = INTENT_CORE
type Core = IntentCore

const capitalised = (value: string) => value.charAt(0).toLocaleUpperCase() + value.slice(1)

// A yearly figure as written: 50000, 50.000, 50,000, 50k, 50 mil. Null if none.
function amountIn(text: string): number | null {
  const match = text.match(/(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(k\b|mil\b)?/i)
  if (!match) return null
  const grouped = /[.,\s]\d{3}$/.test(match[1])
  const value = grouped ? Number(match[1].replace(/[.,\s]/g, '')) : Number(match[1].replace(',', '.'))
  const amount = match[2] ? value * 1000 : value
  return Number.isFinite(amount) && amount >= 1000 ? amount : null
}

// Pay said only against what they earn now ("un 40% más", "el doble"): the
// smallest raise named, as a factor. Null when it states a figure or no raise.
function relativeRaise(values: string[]): number | null {
  if (values.some((value) => amountIn(value) !== null)) return null
  const factors: number[] = []
  for (const value of values) {
    for (const match of value.matchAll(/(\d{1,3})\s*%/g)) factors.push(1 + Number(match[1]) / 100)
    if (/\bdoble\b|\bdouble\b/i.test(value)) factors.push(2)
  }
  return factors.length > 0 ? Math.min(...factors) : null
}

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
  const [missing, setMissing] = useState<Record<Core, string>>({ Compensation: '', Location: '', Role: '' })
  const [current, setCurrent] = useState('')
  const { locale } = useI18n()
  // The groups come with fixed English labels; they are shown in their language.
  const labelOf = (label: string) => (t.intent.labels as Record<string, string>)[label] ?? label

  async function submit() {
    if (!answer.trim()) return
    setPhase('sending')
    setError(null)
    const { ok, status, data } = await postJson<IntentResponse>('/api/intent', { answer })
    if (!ok) {
      setError(status === 0 ? t.intent.unsent : (data.error ?? t.intent.interpretFailed))
      setPhase('ask')
      return
    }
    setResult(data)
    setEditedGroups((data.groups ?? []).map((group) => ({ ...group, values: group.values.map(capitalised) })))
    setPhase('reveal')
  }

  // A row they fill in here: added to its group, or as a new one.
  function addValue(label: string, value: string) {
    const text = capitalised(value.trim())
    if (!text) return
    setEditedGroups((prev) =>
      prev.some((group) => group.label === label)
        ? prev.map((group) => (group.label === label ? { ...group, values: [...group.values, text] } : group))
        : [...prev, { label, values: [text] }],
    )
  }

  const money = (amount: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(amount / 1000) * 1000)

  // What they wrote in an empty row: a bare figure for pay reads as their floor.
  function fillMissing(label: Core) {
    const raw = missing[label].trim()
    if (!raw) return
    const amount = label === 'Compensation' ? amountIn(raw) : null
    addValue(label, amount !== null && raw.replace(/[\d.,\s€k]|mil|eur/gi, '') === '' ? t.intent.payFloor(money(amount)) : raw)
    setMissing((prev) => ({ ...prev, [label]: '' }))
  }

  // "Un 40% más" and what they earn now: the floor, worked out, theirs to change.
  function fillFromCurrent(raise: number) {
    const amount = amountIn(current)
    if (amount === null) return
    addValue('Compensation', t.intent.payFloorFrom(money(amount * raise), money(amount)))
    setCurrent('')
  }

  async function confirm() {
    setConfirming(true)
    setError(null)
    try {
      // From the setup, /listening says it starts listening once the questions are done.
      window.sessionStorage.setItem('amble-listening-activated', setupStep ? 'setup' : '1')
    } catch {
      // Session storage unavailable; the Listening screen still works.
    }
    if (result?.id && !(await postJson('/api/intent', { action: 'confirm', intentId: result.id, groups: editedGroups })).ok) {
      // Not confirmed: they stay here, with what they wrote, to try again.
      setError(t.intent.confirmFailed)
      setConfirming(false)
      return
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

  // During the setup this is a step like the two questions after it: the
  // same bar, with a way to leave that keeps what was written.
  const header = setupStep ? (
    <Header
      nav={false}
      right={
        <Link href="/me" className="text-btn">
          {t.interview.saveAndLeave}
        </Link>
      }
    />
  ) : (
    <Header />
  )

  if (phase === 'ask' || phase === 'sending') {
    return (
      <>
        {header}
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
            {/* Coming back to change it: what is listened for now is one tap away. */}
            {!setupStep && (
              <Link href="/listening" className={`text-btn ${styles.current}`}>
                {t.intent.seeCurrent}
              </Link>
            )}
          </div>
        </main>
      </>
    )
  }

  // What they said in the fixed order, pay, where and role always among it;
  // anything else (their words kept as they were) after.
  const rows: { label: string; index: number | null }[] = [
    ...ORDER.flatMap((label) => {
      const index = editedGroups.findIndex((group) => group.label === label)
      return index >= 0 || (CORE as readonly string[]).includes(label) ? [{ label, index: index >= 0 ? index : null }] : []
    }),
    ...editedGroups.flatMap((group, index) => (ORDER.includes(group.label) ? [] : [{ label: group.label, index }])),
  ]

  return (
    <>
      {header}
      <main className={styles.page}>
        <div className={styles.reveal}>
          {setupStep && <p className={styles.step}>{t.interview.step(setupStep.current, setupStep.total)}</p>}
          <h1 className={styles.revealLead}>{t.intent.revealLead}</h1>
          <p className={styles.revealSub}>{t.intent.revealSub}</p>
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
          {rows.map(({ label, index }, position) => {
            const group = index === null ? null : editedGroups[index]
            const raise = label === 'Compensation' && group ? relativeRaise(group.values) : null
            return (
              <section
                key={label}
                className={styles.group}
                style={{ animationDelay: `${120 + position * 70}ms` }}
                aria-label={labelOf(label)}
              >
                <h2 className={styles.groupLabel}>{labelOf(label)}</h2>
                {group && index !== null && (
                  <div className={styles.values}>
                    {group.values.map((value, valueIndex) => (
                      <div key={`${index}-${valueIndex}`} className={styles.value}>
                        <InlineEdit
                          value={value}
                          label={t.intent.valueLabel(labelOf(label))}
                          onChange={(next) => updateValue(index, valueIndex, next)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {/* Pay said only as a raise: without a figure it cannot be a floor. */}
                {raise !== null && (
                  <form
                    className={styles.fill}
                    onSubmit={(event) => {
                      event.preventDefault()
                      fillFromCurrent(raise)
                    }}
                  >
                    <label className={styles.fillLabel} htmlFor="current-pay">
                      {t.intent.relativePay}
                    </label>
                    <span className={styles.fillRow}>
                      <input
                        id="current-pay"
                        className={styles.fillInput}
                        inputMode="numeric"
                        placeholder={t.intent.currentPlaceholder}
                        value={current}
                        onChange={(event) => setCurrent(event.target.value)}
                      />
                      <button type="submit" className="btn btn-quiet" disabled={amountIn(current) === null}>
                        {t.intent.add}
                      </button>
                    </span>
                  </form>
                )}
                {/* A row not said: shown as such, to say it here. */}
                {!group && (CORE as readonly string[]).includes(label) && (
                  <form
                    className={styles.fill}
                    onSubmit={(event) => {
                      event.preventDefault()
                      fillMissing(label as Core)
                    }}
                  >
                    <label className={styles.fillLabel} htmlFor={`missing-${label}`}>
                      {t.intent.missing[label as Core]}
                    </label>
                    <span className={styles.fillRow}>
                      <input
                        id={`missing-${label}`}
                        className={styles.fillInput}
                        placeholder={t.intent.missingPlaceholder[label as Core]}
                        value={missing[label as Core]}
                        onChange={(event) => setMissing((prev) => ({ ...prev, [label]: event.target.value }))}
                      />
                      <button type="submit" className="btn btn-quiet" disabled={!missing[label as Core].trim()}>
                        {t.intent.add}
                      </button>
                    </span>
                  </form>
                )}
              </section>
            )
          })}
        </div>

        <div className={styles.confirm}>
          <p className={styles.confirmQuestion}>{t.intent.confirmQuestion}</p>
          <div className={styles.confirmActions}>
            <button type="button" className="btn" disabled={confirming} onClick={() => void confirm()}>
              {confirming ? t.intent.confirming : setupStep ? t.intent.confirm : t.intent.confirmSave}
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
