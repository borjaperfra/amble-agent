import { notFound } from 'next/navigation'
import { isUserZero } from '@/lib/features'
import { getDevTrace } from '@/lib/view'
import styles from './user-zero.module.css'
import { getOrCreateCandidate } from '@/lib/db/repo'

export const dynamic = 'force-dynamic'

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

export default function UserZeroTrace() {
  if (!isUserZero() || process.env.NODE_ENV === 'production') notFound()
  const trace = getDevTrace(getOrCreateCandidate().id)

  return (
    <main className={styles.page}>
      <p className={styles.kicker}>USER ZERO — evaluation trace (dev only)</p>
      <h1 className={styles.title}>Professional Graph</h1>

      <div className={styles.stats}>
        <Count label="sources" value={trace.sources.length} />
        <Count label="claims" value={trace.claims.length} />
        <Count label="evidence" value={trace.evidence.length} />
        <Count label="capabilities" value={trace.capabilities.length} />
        <Count
          label="uncertainties open"
          value={trace.uncertainties.filter((u) => u.status === 'OPEN').length}
        />
        <Count
          label="uncertainties resolved"
          value={trace.uncertainties.filter((u) => u.status === 'RESOLVED').length}
        />
        <Count label="interview questions" value={trace.interview.turns.length} />
        <Count label="model runs" value={trace.modelRuns.length} />
      </div>

      <section className={styles.section}>
        <h2 className={styles.h2}>SOURCE → CLAIM</h2>
        {trace.sources.map((source) => (
          <div key={source.id} className={styles.card}>
            <p className={styles.monoStrong}>
              SOURCE · {source.type} · {source.name} · {source.status}
              {source.charCount ? ` · ${source.charCount} chars` : ''}
            </p>
            {source.detail && <p className={styles.monoDim}>{source.detail}</p>}
            <ul className={styles.list}>
              {trace.claims
                .filter((claim) => claim.source === source.name)
                .map((claim) => (
                  <li key={claim.id} className={styles.listItem}>
                    <span className={styles.monoDim}>CLAIM [{claim.epistemic} · {claim.type}]</span>{' '}
                    {claim.statement}
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {trace.claims.filter((claim) => claim.source === null).length > 0 && (
          <div className={styles.card}>
            <p className={styles.monoStrong}>SOURCE · interview</p>
            <ul className={styles.list}>
              {trace.claims
                .filter((claim) => claim.source === null)
                .map((claim) => (
                  <li key={claim.id} className={styles.listItem}>
                    <span className={styles.monoDim}>CLAIM [{claim.epistemic} · {claim.type}]</span>{' '}
                    {claim.statement}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>CLAIM → EVIDENCE → CAPABILITY</h2>
        <div className={styles.card}>
          <ul className={styles.list}>
            {trace.evidence.map((item) => (
              <li key={item.id} className={styles.listItem}>
                <span className={styles.monoId}>{item.id}</span>{' '}
                <span className={styles.monoDim}>[{item.epistemic} · {item.sourceType}{item.confirmed ? ' · confirmed' : ''}]</span>{' '}
                {item.statement}
              </li>
            ))}
          </ul>
        </div>
        {trace.capabilities.map((capability) => (
          <div key={capability.id} className={styles.card}>
            <p className={styles.monoStrong}>
              CAPABILITY · {capability.name} · {capability.assessment}
            </p>
            <p className={styles.mono}>{capability.reason}</p>
            <p className={styles.monoDim}>
              supporting evidence: {capability.evidenceIds.join(', ') || '(none)'}
            </p>
          </div>
        ))}
        {trace.distinctive.length > 0 && (
          <div className={styles.card}>
            <p className={styles.monoStrong}>DISTINCTIVE PROFILE</p>
            <p className={styles.mono}>{trace.distinctive.join(' × ')}</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>UNCERTAINTIES</h2>
        <div className={styles.card}>
          <ul className={styles.list}>
            {trace.uncertainties.map((uncertainty) => (
              <li key={uncertainty.id} className={styles.listItem}>
                <span className={styles.monoId}>{uncertainty.id}</span>{' '}
                <span className={styles.monoDim}>
                  [{uncertainty.status} · {uncertainty.materiality}
                  {uncertainty.capability ? ` · ${uncertainty.capability}` : ''}]
                </span>{' '}
                {uncertainty.description}
              </li>
            ))}
            {trace.uncertainties.length === 0 && (
              <li className={styles.listItem}>No uncertainties recorded.</li>
            )}
          </ul>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>INTERVIEW</h2>
        {trace.interview.turns.map((turn) => (
          <div key={turn.idx} className={styles.card}>
            <p className={styles.monoStrong}>
              Q{turn.idx + 1}: {turn.question}
            </p>
            {turn.reason && <p className={styles.monoDim}>why: {turn.reason}</p>}
            <p className={styles.monoDim}>targeted uncertainties: {turn.targetUncertainties.join(', ') || '(none)'}</p>
            {turn.answer && <p className={styles.mono}>A: {turn.answer}</p>}
            <p className={styles.monoDim}>
              answer produced evidence: {turn.evidenceCreated.join(', ') || '(none)'}
            </p>
          </div>
        ))}
        {trace.interview.turns.length === 0 && (
          <div className={styles.card}>
            <p className={styles.monoDim}>No interview questions yet.</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>MODEL RUNS</h2>
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
              {trace.modelRuns.map((run) => (
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
              {trace.modelRuns.length === 0 && (
                <tr>
                  <td colSpan={7}>No model runs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>EVALUATIONS</h2>
        <div className={styles.card}>
          {trace.evaluations.length === 0 && <p className={styles.monoDim}>None recorded.</p>}
          <ul className={styles.list}>
            {trace.evaluations.map((evaluation, index) => (
              <li key={index} className={styles.listItem}>
                <span className={styles.monoDim}>
                  [{evaluation.targetType} · {evaluation.verdict} · {evaluation.targetId}]
                </span>{' '}
                {evaluation.comment ?? ''}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}
