'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import StatusDot from '@/components/StatusDot'
import { useI18n } from '@/components/I18nProvider'
import { postJson, requestJson } from '@/components/api'
import type { Locale } from '@/lib/i18n/locale'
import styles from '@/app/me/triage/triage.module.css'

type Verdict = 'yes' | 'yes_if' | 'depends' | 'no'
type Kind = 'hard_filter' | 'strong' | 'weak' | 'neutral' | 'compensation' | 'self_filter'
type Decision = 'proposed' | 'confirmed' | 'rejected'

interface Probe {
  id: string
  number: number
  title: string
  description: string
  salaryEur: number | null
  isStatusQuo: boolean
  verdict: Verdict | null
  conditions: string | null
  reason: string | null
  axes?: string[]
}

interface Preference {
  id: string
  kind: Kind
  statement: string
  evidence: string | null
  declared: string | null
  evidenceProbeNumbers: number[]
  quote: string | null
  status: Decision
  addedByYou: boolean
  originalStatement: string | null
  neverInheritSilently: boolean
}

interface Triage {
  id: string
  status: string
  probes: Probe[]
  preferences: Preference[]
}

type Phase = 'empty' | 'designing' | 'offer' | 'ready' | 'analysing' | 'result'

const VERDICTS: Verdict[] = ['yes', 'yes_if', 'depends', 'no']

// Order is the order an agent would apply them in.
const KINDS: Kind[] = ['hard_filter', 'strong', 'compensation', 'weak', 'neutral', 'self_filter']

const salaryFormats: Record<Locale, Intl.NumberFormat> = {
  en: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
  es: new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
}

const request = <T,>() => requestJson<T>('/api/triage')
const post = <T,>(body: Record<string, unknown>) => postJson<T>('/api/triage', body)

// Where a triage opens: its result once analysed, else the first offer still
// unanswered, else ready to be read.
function opening(triage: Triage | null): { phase: Phase; index: number } {
  if (!triage) return { phase: 'empty', index: 0 }
  if (triage.status === 'analysed') return { phase: 'result', index: 0 }
  const firstOpen = triage.probes.findIndex((probe) => probe.verdict === null)
  return firstOpen === -1 ? { phase: 'ready', index: 0 } : { phase: 'offer', index: firstOpen }
}

// The latest triage comes with the page (read on the server), so it opens on
// its first screen without a round trip.
export default function TriageFlow({ initial }: { initial: Triage | null }) {
  const { locale, t } = useI18n()
  const salaryFormat = salaryFormats[locale]
  const [start] = useState(() => opening(initial))
  const firstProbe = start.phase === 'offer' ? initial?.probes[start.index] : undefined
  const [phase, setPhase] = useState<Phase>(start.phase)
  const [triage, setTriage] = useState<Triage | null>(initial)
  const [index, setIndex] = useState(start.index)
  const [verdict, setVerdict] = useState<Verdict | null>(firstProbe?.verdict ?? null)
  const [conditions, setConditions] = useState(firstProbe?.conditions ?? '')
  const [reason, setReason] = useState(firstProbe?.reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadForm = useCallback((probe: Probe | undefined) => {
    setVerdict(probe?.verdict ?? null)
    setConditions(probe?.conditions ?? '')
    setReason(probe?.reason ?? '')
  }, [])

  const show = useCallback(
    (next: Triage) => {
      setTriage(next)
      if (next.status === 'analysed') {
        setPhase('result')
        return
      }
      const firstOpen = next.probes.findIndex((probe) => probe.verdict === null)
      if (firstOpen === -1) {
        setPhase('ready')
        return
      }
      setIndex(firstOpen)
      loadForm(next.probes[firstOpen])
      setPhase('offer')
    },
    [loadForm],
  )

  // Each phase and each offer is a new screen; coming from the long result page
  // the next one must not open scrolled halfway down.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [phase, index])

  async function design() {
    setPhase('designing')
    setError(null)
    const { ok, data } = await post<Triage>({ action: 'generate' })
    if (ok) show(data)
    else {
      setError(data.error ?? t.triage.designFailed)
      setPhase(triage ? 'result' : 'empty')
    }
  }

  async function saveAnswer() {
    if (!triage || !verdict) return
    const probe = triage.probes[index]
    setSaving(true)
    setError(null)
    const { ok, data } = await post({
      action: 'answer',
      probeId: probe.id,
      verdict,
      conditions: verdict === 'yes_if' ? conditions : null,
      reason,
    })
    if (!ok) {
      setSaving(false)
      setError(data.error ?? t.triage.saveFailed)
      return
    }
    const refreshed = await request<Triage>()
    setSaving(false)
    if (!refreshed.ok) {
      setError(t.triage.nextFailed)
      return
    }
    // Move forward from where the candidate is, not to the first gap: going back
    // to change an answer must not jump them around.
    const next = refreshed.data.probes.findIndex((p, i) => i > index && p.verdict === null)
    const anyOpen = refreshed.data.probes.findIndex((p) => p.verdict === null)
    setTriage(refreshed.data)
    const target = next !== -1 ? next : anyOpen
    if (target === -1) {
      setPhase('ready')
      return
    }
    setIndex(target)
    loadForm(refreshed.data.probes[target])
  }

  function goBack() {
    if (!triage || index === 0) return
    setIndex(index - 1)
    loadForm(triage.probes[index - 1])
    setError(null)
    setPhase('offer')
  }

  async function analyse() {
    setPhase('analysing')
    setError(null)
    const { ok, data } = await post<{ triage: Triage }>({ action: 'analyse' })
    if (ok) show(data.triage)
    else {
      setError(data.error ?? t.triage.analyseFailed)
      setPhase('ready')
    }
  }

  async function decide(preferenceId: string, decision: 'confirmed' | 'rejected') {
    if (!triage) return
    const previous = triage
    setTriage({
      ...triage,
      preferences: triage.preferences.map((p) => (p.id === preferenceId ? { ...p, status: decision } : p)),
    })
    const { ok } = await post({ action: 'decide', preferenceId, decision })
    if (!ok) {
      setTriage(previous)
      setError(t.triage.decideFailed)
    }
  }

  const total = triage?.probes.length ?? 0
  const probe = triage?.probes[index]
  const canSave = verdict !== null && (verdict !== 'yes_if' || conditions.trim().length > 0) && !saving

  return (
    <>
      <Header />
      <main className={styles.page}>
        {phase === 'empty' && (
          <div className={styles.center}>
            <p className="kicker rep-kicker">
              <Symbol size={20} /> {t.common.yourRep}
            </p>
            <h1 className={styles.question}>{t.triage.emptyTitle}</h1>
            <p className={styles.lead}>
              {t.triage.emptyLead(total || 8)}
            </p>
            <button type="button" className="btn" onClick={() => void design()}>
              {t.triage.showOffers}
            </button>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {phase === 'designing' && (
          <div className={styles.center} role="status">
            <StatusDot />
            <p className={styles.working}>{t.triage.designing}</p>
          </div>
        )}

        {phase === 'offer' && probe && (
          <form
            className={styles.offer}
            key={probe.id}
            onSubmit={(event) => {
              event.preventDefault()
              void saveAnswer()
            }}
          >
            <p className="kicker">
              {t.triage.offerOf(probe.number, total)}
            </p>
            <h1 className={styles.offerTitle}>{probe.title}</h1>
            {probe.salaryEur !== null && <p className={styles.salary}>{salaryFormat.format(probe.salaryEur)}</p>}
            <p className={styles.offerDescription}>{probe.description}</p>

            <fieldset className={styles.verdicts}>
              <legend className="visually-hidden">{t.triage.wouldYouTakeIt}</legend>
              {VERDICTS.map((option) => (
                <label key={option} className={styles.verdict} data-selected={verdict === option}>
                  <input
                    type="radio"
                    name="verdict"
                    value={option}
                    checked={verdict === option}
                    onChange={() => setVerdict(option)}
                    className="visually-hidden"
                  />
                  {t.triage.verdicts[option]}
                </label>
              ))}
            </fieldset>

            {verdict === 'yes_if' && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="triage-conditions">
                  {t.triage.ifWhat}
                </label>
                <input
                  id="triage-conditions"
                  className={styles.input}
                  value={conditions}
                  onChange={(event) => setConditions(event.target.value)}
                  autoFocus
                />
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="triage-reason">
                {t.triage.whatDecided}
              </label>
              <textarea
                id="triage-reason"
                className={styles.textarea}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSave) void saveAnswer()
                }}
              />
              <p className={styles.hint}>
                {verdict === 'no' || verdict === 'depends'
                  ? t.triage.hintNo
                  : t.triage.hintOptional}
              </p>
            </div>

            <div className={styles.actions}>
              <button type="submit" className="btn" disabled={!canSave}>
                {saving ? t.triage.saving : probe.number === total ? t.triage.lastOne : t.triage.nextOffer}
              </button>
              {index > 0 && (
                <button type="button" className="text-btn" onClick={goBack} disabled={saving}>
                  {t.triage.previous}
                </button>
              )}
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </form>
        )}

        {phase === 'ready' && (
          <div className={styles.center}>
            <p className="kicker rep-kicker">
              <Symbol size={20} /> {t.common.yourRep}
            </p>
            <h1 className={styles.question}>{t.triage.allDone(total)}</h1>
            <p className={styles.lead}>{t.triage.notRandom}</p>
            <button type="button" className="btn" onClick={() => void analyse()}>
              {t.triage.showMe}
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                if (!triage) return
                setIndex(total - 1)
                loadForm(triage.probes[total - 1])
                setPhase('offer')
              }}
            >
              {t.triage.changeAnswer}
            </button>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {phase === 'analysing' && (
          <div className={styles.center} role="status">
            <StatusDot />
            <p className={styles.working}>{t.triage.analysing}</p>
          </div>
        )}

        {phase === 'result' && triage && (
          <Result triage={triage} error={error} onDecide={decide} onDesign={() => void design()} />
        )}
      </main>
    </>
  )
}

// The rule stands on its own; how it was learned is there for whoever asks.
function Why({ preference }: { preference: Preference }) {
  const { t } = useI18n()
  const { evidence, declared, quote, evidenceProbeNumbers, originalStatement } = preference
  if (!evidence && !declared && !quote && evidenceProbeNumbers.length === 0 && !originalStatement) return null
  return (
    <details className={styles.why}>
      <summary className={styles.whySummary}>{t.triage.why}</summary>
      <div className={styles.whyBody}>
        {evidence && <p className={styles.whyText}>{evidence}</p>}
        {quote && <blockquote className={styles.quote}>&ldquo;{quote}&rdquo;</blockquote>}
        {declared && <p className={styles.meta}>{t.triage.youdSaid(declared)}</p>}
        {evidenceProbeNumbers.length > 0 && <p className={styles.meta}>{t.triage.fromOffers(evidenceProbeNumbers)}</p>}
        {originalStatement && <p className={styles.meta}>{t.triage.correctedByYou(originalStatement)}</p>}
      </div>
    </details>
  )
}

function Result({
  triage,
  error,
  onDecide,
  onDesign,
}: {
  triage: Triage
  error: string | null
  onDecide: (id: string, decision: 'confirmed' | 'rejected') => void
  onDesign: () => void
}) {
  const { locale, t } = useI18n()
  const salaryFormat = salaryFormats[locale]
  const pending = triage.preferences.filter((p) => p.status === 'proposed').length

  return (
    <div className={styles.result}>
      <p className="kicker rep-kicker">
              <Symbol size={20} /> {t.common.yourRep}
            </p>
      <h1 className={styles.resultTitle}>{t.triage.resultTitle}</h1>
      <p className={styles.lead}>{t.triage.resultLead}</p>
      <p className={styles.hint} role="status">
        {pending > 0
          ? t.triage.pending(pending)
          : t.triage.allReviewed}
      </p>

      {KINDS.map((kind) => {
        const label = t.triage.kinds[kind]
        const items = triage.preferences.filter((p) => p.kind === kind)
        if (items.length === 0) return null
        return (
          <section key={kind} className={styles.group} aria-label={label}>
            <h2 className={styles.groupLabel}>{label}</h2>
            {items.map((preference) => (
              <article key={preference.id} className={styles.preference} data-status={preference.status}>
                <p className={styles.statement}>{preference.statement}</p>
                {preference.neverInheritSilently && (
                  <p className={styles.notice}>{t.triage.neverInherit}</p>
                )}
                {preference.addedByYou && <p className={styles.meta}>{t.triage.addedByYou}</p>}
                <Why preference={preference} />
                <div className={styles.decision} role="group" aria-label={t.triage.isThisRight}>
                  <button
                    type="button"
                    className={styles.decisionBtn}
                    aria-pressed={preference.status === 'confirmed'}
                    onClick={() => onDecide(preference.id, 'confirmed')}
                  >
                    {t.triage.right}
                  </button>
                  <button
                    type="button"
                    className={styles.decisionBtn}
                    aria-pressed={preference.status === 'rejected'}
                    onClick={() => onDecide(preference.id, 'rejected')}
                  >
                    {t.triage.notQuite}
                  </button>
                </div>
                {/* Each decision is saved on click; say so, there is no save button. */}
                {preference.status !== 'proposed' && (
                  <p className={styles.saved} role="status">
                    {preference.status === 'rejected'
                      ? t.triage.savedRejected
                      : preference.kind === 'self_filter'
                        ? t.triage.savedSelfFilter
                        : t.triage.savedConfirmed}
                  </p>
                )}
              </article>
            ))}
          </section>
        )
      })}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <details className={styles.offers}>
        <summary className={styles.offersSummary}>{t.triage.whatTesting}</summary>
        <ol className={styles.offerList}>
          {triage.probes.map((probe) => (
            <li key={probe.id} className={styles.offerItem}>
              <p className={styles.offerItemTitle}>
                #{probe.number} {probe.title}
                {probe.salaryEur !== null && ` · ${salaryFormat.format(probe.salaryEur)}`}
              </p>
              <p className={styles.meta}>
                {probe.verdict ? t.triage.verdicts[probe.verdict] : '—'}
                {probe.conditions && ` — ${probe.conditions}`}
              </p>
              {probe.reason && <p className={styles.offerReason}>&ldquo;{probe.reason}&rdquo;</p>}
              {probe.axes && probe.axes.length > 0 && <p className={styles.meta}>{t.triage.testing(probe.axes)}</p>}
            </li>
          ))}
        </ol>
      </details>

      <div className={styles.footer}>
        <button type="button" className="text-btn" onClick={onDesign}>
          {t.triage.anotherSet}
        </button>
        <Link href="/listening" className="text-btn">
          {t.triage.backToListening}
        </Link>
      </div>
    </div>
  )
}
