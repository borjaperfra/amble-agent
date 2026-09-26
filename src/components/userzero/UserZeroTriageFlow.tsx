'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
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
  declared: string | null
  evidenceProbeNumbers: number[]
  quote: string | null
  status: Decision
  neverInheritSilently: boolean
}

interface Triage {
  id: string
  status: string
  probes: Probe[]
  preferences: Preference[]
}

type Phase = 'loading' | 'empty' | 'designing' | 'offer' | 'ready' | 'analysing' | 'result'

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: 'yes', label: "I'd take it" },
  { value: 'yes_if', label: 'Yes, if…' },
  { value: 'depends', label: 'It depends' },
  { value: 'no', label: 'Not for me' },
]

const VERDICT_LABEL: Record<Verdict, string> = Object.fromEntries(VERDICTS.map((v) => [v.value, v.label])) as Record<
  Verdict,
  string
>

// Order is the order an agent would apply them in.
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'hard_filter', label: 'Ends an offer, at any price' },
  { kind: 'strong', label: 'Decides between offers' },
  { kind: 'compensation', label: 'What money does' },
  { kind: 'weak', label: "Didn't decide anything" },
  { kind: 'neutral', label: "Doesn't filter" },
  { kind: 'self_filter', label: 'Worth talking about' },
]

const salaryFormat = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

async function request<T>(init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const response = await fetch('/api/triage', init)
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  return { ok: response.ok, status: response.status, data }
}

function post<T>(body: Record<string, unknown>) {
  return request<T>({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export default function UserZeroTriageFlow() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [triage, setTriage] = useState<Triage | null>(null)
  const [index, setIndex] = useState(0)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [conditions, setConditions] = useState('')
  const [reason, setReason] = useState('')
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

  useEffect(() => {
    let cancelled = false
    void request<Triage>().then(({ ok, status, data }) => {
      if (cancelled) return
      if (status === 404) setPhase('empty')
      else if (ok) show(data)
      else {
        setError(data.error ?? "I couldn't load your offers. Nothing has been lost.")
        setPhase('empty')
      }
    })
    return () => {
      cancelled = true
    }
  }, [show])

  async function design() {
    setPhase('designing')
    setError(null)
    const { ok, data } = await post<Triage>({ action: 'generate' })
    if (ok) show(data)
    else {
      setError(data.error ?? "I couldn't put the offers together. Nothing has been saved.")
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
      setError(data.error ?? "Your answer couldn't be saved. It's still here — try again.")
      return
    }
    const refreshed = await request<Triage>()
    setSaving(false)
    if (!refreshed.ok) {
      setError("Saved, but I couldn't load the next offer. Reload the page.")
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
      setError(data.error ?? "I couldn't read your answers just now. They're all saved — try again.")
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
      setError("That didn't save. Try again.")
    }
  }

  const total = triage?.probes.length ?? 0
  const probe = triage?.probes[index]
  const canSave = verdict !== null && (verdict !== 'yes_if' || conditions.trim().length > 0) && !saving

  return (
    <>
      <Header />
      <main className={styles.page}>
        {phase === 'loading' && (
          <div className={styles.center} role="status">
            <StatusDot />
          </div>
        )}

        {phase === 'empty' && (
          <div className={styles.center}>
            <p className="kicker">Your Rep</p>
            <h1 className={styles.question}>What would you actually trade?</h1>
            <p className={styles.lead}>
              I&rsquo;ll show you {total || 'eight'} offers. Each one costs you something you said you want. Answer the
              way you would if it were real.
            </p>
            <button type="button" className="btn" onClick={() => void design()}>
              Show me the offers
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
            <p className={styles.working}>Putting together offers that cost you something…</p>
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
              Offer {probe.number} of {total}
            </p>
            <h1 className={styles.offerTitle}>{probe.title}</h1>
            {probe.salaryEur !== null && <p className={styles.salary}>{salaryFormat.format(probe.salaryEur)}</p>}
            <p className={styles.offerDescription}>{probe.description}</p>

            <fieldset className={styles.verdicts}>
              <legend className="visually-hidden">Would you take it?</legend>
              {VERDICTS.map((option) => (
                <label key={option.value} className={styles.verdict} data-selected={verdict === option.value}>
                  <input
                    type="radio"
                    name="verdict"
                    value={option.value}
                    checked={verdict === option.value}
                    onChange={() => setVerdict(option.value)}
                    className="visually-hidden"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            {verdict === 'yes_if' && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="triage-conditions">
                  If what?
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
                What decided it?
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
                  ? 'A no with its reason tells me more than any yes. Your words are kept exactly.'
                  : 'Optional. Your words are kept exactly.'}
              </p>
            </div>

            <div className={styles.actions}>
              <button type="submit" className="btn" disabled={!canSave}>
                {saving ? 'Saving…' : probe.number === total ? "That's the last one" : 'Next offer →'}
              </button>
              {index > 0 && (
                <button type="button" className="text-btn" onClick={goBack} disabled={saving}>
                  ← Previous offer
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
            <p className="kicker">Your Rep</p>
            <h1 className={styles.question}>That&rsquo;s all {total}.</h1>
            <p className={styles.lead}>None of them was random. Want to see what your answers say?</p>
            <button type="button" className="btn" onClick={() => void analyse()}>
              Show me
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
              ← Change an answer
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
            <p className={styles.working}>Reading your answers against what you told me…</p>
          </div>
        )}

        {phase === 'result' && triage && (
          <Result triage={triage} error={error} onDecide={decide} onDesign={() => void design()} />
        )}
      </main>
    </>
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
  const pending = triage.preferences.filter((p) => p.status === 'proposed').length

  return (
    <div className={styles.result}>
      <p className="kicker">Your Rep</p>
      <h1 className={styles.resultTitle}>Here&rsquo;s what your answers say.</h1>
      <p className={styles.lead}>Not what you told me you want. What you chose when it cost something.</p>
      <p className={styles.hint} role="status">
        {pending > 0
          ? `Nothing here changes what I listen for until you confirm it. ${pending} still to review.`
          : 'All reviewed. Only what you confirmed will shape what I listen for.'}
      </p>

      {KINDS.map(({ kind, label }) => {
        const items = triage.preferences.filter((p) => p.kind === kind)
        if (items.length === 0) return null
        return (
          <section key={kind} className={styles.group} aria-label={label}>
            <h2 className={styles.groupLabel}>{label}</h2>
            {items.map((preference) => (
              <article key={preference.id} className={styles.preference} data-status={preference.status}>
                <p className={styles.statement}>{preference.statement}</p>
                {preference.neverInheritSilently && (
                  <p className={styles.notice}>I won&rsquo;t act on this without talking to you first.</p>
                )}
                {preference.declared && <p className={styles.meta}>You&rsquo;d said: {preference.declared}</p>}
                {preference.quote && <blockquote className={styles.quote}>&ldquo;{preference.quote}&rdquo;</blockquote>}
                <p className={styles.meta}>
                  From offer{preference.evidenceProbeNumbers.length > 1 ? 's' : ''}{' '}
                  {preference.evidenceProbeNumbers.map((n) => `#${n}`).join(', ')}
                </p>
                <div className={styles.decision} role="group" aria-label="Is this right?">
                  <button
                    type="button"
                    className={styles.decisionBtn}
                    aria-pressed={preference.status === 'confirmed'}
                    onClick={() => onDecide(preference.id, 'confirmed')}
                  >
                    That&rsquo;s right
                  </button>
                  <button
                    type="button"
                    className={styles.decisionBtn}
                    aria-pressed={preference.status === 'rejected'}
                    onClick={() => onDecide(preference.id, 'rejected')}
                  >
                    Not quite
                  </button>
                </div>
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
        <summary className={styles.offersSummary}>What each offer was testing</summary>
        <ol className={styles.offerList}>
          {triage.probes.map((probe) => (
            <li key={probe.id} className={styles.offerItem}>
              <p className={styles.offerItemTitle}>
                #{probe.number} {probe.title}
                {probe.salaryEur !== null && ` · ${salaryFormat.format(probe.salaryEur)}`}
              </p>
              <p className={styles.meta}>
                {probe.verdict ? VERDICT_LABEL[probe.verdict] : '—'}
                {probe.conditions && ` — ${probe.conditions}`}
              </p>
              {probe.reason && <p className={styles.offerReason}>&ldquo;{probe.reason}&rdquo;</p>}
              {probe.axes && probe.axes.length > 0 && <p className={styles.meta}>Testing: {probe.axes.join(' × ')}</p>}
            </li>
          ))}
        </ol>
      </details>

      <div className={styles.footer}>
        <button type="button" className="text-btn" onClick={onDesign}>
          Try another set of offers →
        </button>
        <Link href="/listening" className="text-btn">
          Back to listening
        </Link>
      </div>
    </div>
  )
}
