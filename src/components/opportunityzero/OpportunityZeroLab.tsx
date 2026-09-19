'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from '@/app/dev/opportunity-zero/opportunity-zero.module.css'
import { EvaluationControl } from '@/components/userzero/EvaluationControl'
import type {
  DecisionMatrixCell,
  OpportunityLabViewModel,
  OpportunityTraceItem,
} from '@/lib/opportunity-view'
import type { Decision, HumanLabel } from '@/domains/opportunity/types'

const LABELS: HumanLabel[] = ['YES', 'MAYBE', 'NO']
const DECISIONS: Decision[] = ['INTERRUPT', 'HOLD', 'IGNORE']

/** Explanations get the same verdicts a capability gets on the Map. */
const EXPLANATION_VERDICTS = ['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']

function badgeClass(decision: Decision): string {
  return decision === 'INTERRUPT'
    ? `${styles.badge} ${styles.badgeInterrupt}`
    : decision === 'HOLD'
      ? `${styles.badge} ${styles.badgeHold}`
      : `${styles.badge} ${styles.badgeIgnore}`
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

/**
 * Human NO + INTERRUPT is noise, and human YES + IGNORE is a miss. Both are
 * the errors that matter; MAYBE against HOLD is uncertainty landing where it
 * should. Nothing here is scored — the cells are marked so the eye finds
 * them, and the raw counts are what gets kept.
 */
function matrixTone(label: HumanLabel, decision: Decision): string {
  if (label === 'NO' && decision === 'INTERRUPT') return styles.miss
  if (label === 'YES' && decision === 'IGNORE') return styles.miss
  if (label === 'YES' && decision === 'INTERRUPT') return styles.hit
  if (label === 'MAYBE' && decision === 'HOLD') return styles.hit
  if (label === 'NO' && decision === 'IGNORE') return styles.hit
  return ''
}

export default function OpportunityZeroLab({ initial }: { initial: OpportunityLabViewModel }) {
  const [vm, setVm] = useState(initial)
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [url, setUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [label, setLabel] = useState<HumanLabel | null>(null)
  const [labelComment, setLabelComment] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [sending, setSending] = useState(false)
  const [pulling, setPulling] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/opportunities')
      if (response.ok) setVm((await response.json()) as OpportunityLabViewModel)
    } catch {
      // The bench can miss a beat. The next tick picks it up.
    }
  }, [])

  // The reading runs on the queue, so the page watches rather than waits.
  const busy = vm.queue.busy
  useEffect(() => {
    if (!busy) return
    const id = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(id)
  }, [busy, refresh])

  async function submit() {
    if (!company.trim() || !role.trim() || rawText.trim().length < 40 || !label) return
    setSending(true)
    setFailed(false)
    setStatus('Queued. Reading it now.')
    try {
      const response = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, role, url, rawText, label, labelComment }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        setFailed(true)
        setStatus(body.error ?? 'That did not go in.')
      } else {
        setCompany('')
        setRole('')
        setUrl('')
        setRawText('')
        setLabel(null)
        setLabelComment('')
        await refresh()
      }
    } catch {
      setFailed(true)
      setStatus('No connection. Nothing was sent.')
    } finally {
      setSending(false)
    }
  }

  /**
   * Go and look at Manfred. The reading happens on the queue and the screen
   * finds out afterwards, which is the same shape as everything else here.
   */
  async function pull() {
    setPulling(true)
    setFailed(false)
    setStatus('Reading the feed. Offers that fail on pay or presence never reach the model.')
    try {
      const response = await fetch('/api/sources/manfred', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 40, maxEvaluations: 10 }),
      })
      const body = (await response.json()) as { error?: string; alreadyRunning?: boolean }
      if (!response.ok) {
        setFailed(true)
        setStatus(body.error ?? 'The feed did not answer.')
      } else if (body.alreadyRunning) {
        setStatus('Already reading it.')
      }
      await refresh()
    } catch {
      setFailed(true)
      setStatus('No connection. Nothing was fetched.')
    } finally {
      setPulling(false)
    }
  }

  const cell = (cells: DecisionMatrixCell[], labelValue: HumanLabel, decision: Decision) =>
    cells.find((item) => item.label === labelValue && item.decision === decision)?.count ?? 0

  return (
    <main className={styles.page}>
      <p className={styles.kicker}>OPPORTUNITY ZERO — evaluation trace (dev only)</p>
      <h1 className={styles.title}>Is this worth interrupting you for?</h1>
      <p className={styles.question}>
        Label it first, then run it. Amble never sees the label — it is written to its own table,
        and nothing that builds a prompt reads that table.
      </p>

      {!vm.graphReady && (
        <div className={`${styles.card} ${styles.warn}`}>
          <p className={styles.monoStrong}>There is no Professional Graph to hold anything against.</p>
          <p className={styles.monoDim}>
            Run the User Zero journey first: add a CV at /onboarding, then answer a few questions.
            Matching reads assessed evidence, not documents, so without capabilities there is
            nothing to match.
          </p>
        </div>
      )}

      <div className={styles.stats}>
        <Count label="opportunities" value={vm.counts.total} />
        <Count label="decided" value={vm.counts.decided} />
        <Count label="interrupt" value={vm.counts.INTERRUPT} />
        <Count label="hold" value={vm.counts.HOLD} />
        <Count label="ignore" value={vm.counts.IGNORE} />
        <Count label="rules overrode" value={vm.counts.overridden} />
        <Count label="hard fails" value={vm.counts.hardConstraintFailures} />
        <Count label="unsupported claims" value={vm.counts.unsupportedClaims} />
        <Count label="capabilities" value={vm.capabilitiesCount} />
        <Count label="evidence" value={vm.evidenceCount} />
      </div>

      <section className={styles.section}>
        <h2 className={styles.h2}>New opportunity</h2>
        <div className={styles.form}>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="oz-company">
                Company
              </label>
              <input
                id="oz-company"
                className={styles.input}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="oz-role">
                Role
              </label>
              <input
                id="oz-role"
                className={styles.input}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="oz-url">
                Link (optional)
              </label>
              <input
                id="oz-url"
                className={styles.input}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="oz-text">
              The opportunity, pasted
            </label>
            <textarea
              id="oz-text"
              className={styles.textarea}
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
            />
          </div>

          <div className={styles.formRow} style={{ marginTop: 12 }}>
            <div className={styles.field}>
              <span className={styles.label}>Would you want Amble to interrupt you for this?</span>
              <div className={styles.labelChips}>
                {LABELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`${styles.chip} ${label === option ? styles.chipOn : ''}`}
                    aria-pressed={label === option}
                    onClick={() => setLabel(label === option ? null : option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <p className={styles.blindNote}>
                Answer before you run it. Afterwards you will be reading Amble&rsquo;s answer, not
                your own.
              </p>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="oz-why">
                Why (optional)
              </label>
              <input
                id="oz-why"
                className={styles.input}
                value={labelComment}
                onChange={(event) => setLabelComment(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.run}
              disabled={sending || !label || !company.trim() || !role.trim() || rawText.trim().length < 40}
              onClick={() => void submit()}
            >
              Run Amble
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={pulling}
              onClick={() => void pull()}
            >
              Pull from Manfred
            </button>
            <button type="button" className={styles.secondary} onClick={() => void refresh()}>
              Refresh
            </button>
            <span className={failed ? styles.statusError : styles.status}>
              {status ?? (busy ? `Working: ${vm.queue.kinds.join(', ')}` : '')}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Human label × Amble decision</h2>
        <div className={styles.card}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th />
                {DECISIONS.map((decision) => (
                  <th key={decision}>{decision}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LABELS.map((labelValue) => (
                <tr key={labelValue}>
                  <td className={styles.matrixRowHead}>{labelValue}</td>
                  {DECISIONS.map((decision) => (
                    <td key={decision} className={matrixTone(labelValue, decision)}>
                      {cell(vm.matrix, labelValue, decision)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.blindNote}>
            NO × INTERRUPT is noise. YES × IGNORE is a miss. Those two are the ones that matter;
            the rest is raw observation, not a score.
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Opportunities</h2>
        {vm.opportunities.length === 0 && (
          <div className={styles.card}>
            <p className={styles.monoDim}>Nothing has come in yet.</p>
          </div>
        )}
        {vm.opportunities.map((item) => (
          <OpportunityCard key={item.id} item={item} />
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>What was sent</h2>
        <div className={styles.card}>
          {vm.notifications.length === 0 && (
            <p className={styles.monoDim}>
              Nothing to send yet. Only an interruption is ever sent anywhere.
            </p>
          )}
          <ul className={styles.list}>
            {vm.notifications.map((note) => (
              <li key={note.id} className={styles.listItem}>
                <span className={styles.monoDim}>{note.createdAt.slice(11, 19)}</span>{' '}
                <span className={styles.monoId}>{note.channel}</span>{' '}
                <span className={note.status === 'sent' ? styles.hit : styles.monoDim}>
                  {note.status}
                </span>{' '}
                {note.address ?? '(nowhere to send it)'}
                {note.lastError && <p className={styles.monoDim}>{note.lastError}</p>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Model runs</h2>
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>created</th>
                <th>task</th>
                <th>version</th>
                <th>model</th>
                <th>latency</th>
                <th>ok</th>
                <th>error</th>
              </tr>
            </thead>
            <tbody>
              {vm.modelRuns.map((run) => (
                <tr key={run.id}>
                  <td>{run.createdAt.slice(11, 19)}</td>
                  <td>{run.task}</td>
                  <td>{run.version}</td>
                  <td>{run.model}</td>
                  <td>{run.latencyMs !== null ? `${run.latencyMs}ms` : '—'}</td>
                  <td>{run.ok ? 'yes' : 'NO'}</td>
                  <td className={run.ok ? '' : styles.errorCell}>{run.error ?? ''}</td>
                </tr>
              ))}
              {vm.modelRuns.length === 0 && (
                <tr>
                  <td colSpan={7}>No model runs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function OpportunityCard({ item }: { item: OpportunityTraceItem }) {
  const decision = item.decision

  return (
    <div className={styles.card}>
      <div className={styles.decisionRow}>
        <span className={styles.monoStrong}>
          {item.role} · {item.company}
        </span>
        {item.humanLabel && (
          <span className={`${styles.badge} ${styles.badgeLabel}`}>
            HUMAN {item.humanLabel.label}
            {item.humanLabel.origin === 'fixture' ? ' (fixture)' : ''}
          </span>
        )}
        {decision ? (
          <span className={badgeClass(decision.decision)}>AMBLE {decision.decision}</span>
        ) : (
          <span className={styles.monoDim}>{item.status}…</span>
        )}
        {decision?.modelDecision && decision.modelDecision !== decision.decision && (
          <span className={styles.monoDim}>model said {decision.modelDecision}</span>
        )}
      </div>

      {item.humanLabel?.comment && (
        <p className={styles.monoDim}>your note: {item.humanLabel.comment}</p>
      )}

      {/* Screened out by the free check on the feed's own numbers, before
          anything reached a model. The reason is the point. */}
      {item.status === 'screened_out' && item.statusDetail && (
        <p className={styles.monoDim}>screened out: {item.statusDetail}</p>
      )}

      {decision && (
        <>
          <p>{decision.reason}</p>
          {decision.overrideReason && (
            <p className={styles.override}>
              rules overrode the model: {decision.overrideReason}
            </p>
          )}
          {decision.decision === 'HOLD' && (
            <p className={styles.monoDim}>
              next: {decision.nextBestAction.type}
              {decision.nextBestAction.question ? ` — “${decision.nextBestAction.question}”` : ''}
            </p>
          )}
          {decision.unsupportedClaims.length > 0 && (
            <p className={styles.override}>
              {decision.unsupportedClaims.length} unsupported claim
              {decision.unsupportedClaims.length === 1 ? '' : 's'} dropped from the explanation
            </p>
          )}
          {item.response && <p className={styles.monoDim}>candidate answered: {item.response}</p>}
        </>
      )}

      {item.analysis && (
        <details className={styles.detail}>
          <summary>hard constraints · evidence match · intent match · unknowns</summary>
          <ul className={styles.list}>
            {item.analysis.hardConstraints.map((check) => (
              <li key={check.id} className={styles.listItem}>
                <span className={styles.monoDim}>
                  HARD [{check.verdict}
                  {check.deterministic ? ' · in code' : ' · proposed'}]
                </span>{' '}
                {check.constraint} — {check.basis}
              </li>
            ))}
            {item.analysis.evidenceMatch.map((match) => (
              <li key={match.requirementId} className={styles.listItem}>
                <span className={styles.monoDim}>
                  EVIDENCE [{match.verdict} · {match.importance}]
                </span>{' '}
                {match.requirement} — {match.note}{' '}
                <span className={styles.monoId}>{match.evidenceIds.join(', ')}</span>
              </li>
            ))}
            {item.analysis.intentMatch.map((match) => (
              <li key={match.id} className={styles.listItem}>
                <span className={styles.monoDim}>INTENT [{match.verdict}]</span> {match.aspect} —{' '}
                {match.note} <span className={styles.monoId}>{match.intentRefs.join(', ')}</span>
              </li>
            ))}
            {item.analysis.unknowns.map((unknown) => (
              <li key={unknown.id} className={styles.listItem}>
                <span className={styles.monoDim}>
                  UNKNOWN [{unknown.materiality} · {unknown.side}]
                </span>{' '}
                {unknown.description}
                {unknown.resolvedBy.question ? ` → ${unknown.resolvedBy.question}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {decision?.explanation && (
        <details className={styles.detail} open>
          <summary>what the candidate is shown</summary>
          <p className={styles.monoStrong}>{decision.explanation.headline}</p>
          <p>{decision.explanation.whyShowing.text}</p>
          <ul className={styles.list}>
            {decision.explanation.whyYou.map((claim, index) => (
              <li key={index} className={styles.listItem}>
                {claim.text}{' '}
                <span className={styles.monoId}>{claim.evidenceIds.join(', ')}</span>
              </li>
            ))}
            {decision.explanation.whatToConsider.map((consider, index) => (
              <li key={index} className={styles.listItem}>
                <span className={styles.monoDim}>still open:</span> {consider.text}
              </li>
            ))}
          </ul>
          <EvaluationControl
            targetType="opportunity_explanation"
            targetId={decision.id}
            label="Rate this explanation"
            verdicts={EXPLANATION_VERDICTS}
          />
        </details>
      )}

      {item.rubric && (
        <details className={styles.detail}>
          <summary>rubric</summary>
          <pre className={styles.pre}>{JSON.stringify(item.rubric, null, 2)}</pre>
        </details>
      )}

      <details className={styles.detail}>
        <summary>audit trail ({item.audit.length})</summary>
        <ul className={styles.list}>
          {item.audit.map((event, index) => (
            <li key={index} className={styles.listItem}>
              <span className={styles.monoDim}>{event.at.slice(11, 19)}</span>{' '}
              <span className={styles.monoId}>{event.event}</span>{' '}
              {event.modelRunId ? <span className={styles.monoDim}>{event.modelRunId}</span> : null}
              <pre className={styles.pre}>{JSON.stringify(event.detail)}</pre>
            </li>
          ))}
        </ul>
      </details>

      {decision && (
        <EvaluationControl
          targetType="opportunity_decision"
          targetId={decision.id}
          label="Rate this decision"
          verdicts={['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']}
        />
      )}
    </div>
  )
}
