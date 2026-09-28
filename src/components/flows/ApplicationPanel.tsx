'use client'

import { useState } from 'react'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import type { PreparedAnswer, PreparedApplication } from '@/lib/apply/prepare'
import styles from '@/app/opportunities/application.module.css'

// "Prepare my application": how to apply, a message, and the form field by
// field: what the Rep filled in, what it wrote, and what is theirs to decide.

function CopyButton({ text }: { text: string }) {
  const t = useT().opportunities.apply
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={styles.copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        } catch {
          // Clipboard unavailable: the text is on screen to select.
        }
      }}
    >
      {copied ? t.copied : t.copy}
    </button>
  )
}

function Field({ answer }: { answer: PreparedAnswer }) {
  const t = useT().opportunities.apply
  return (
    <li className={`${styles.field} ${styles[answer.source]}`}>
      <p className={styles.fieldLabel}>
        {answer.label}
        {answer.required && <span className={styles.required} aria-label={t.required}> *</span>}
      </p>
      {answer.answer ? (
        <div className={styles.fieldAnswer}>
          <p className={styles.answerText}>{answer.answer}</p>
          <CopyButton text={answer.answer} />
        </div>
      ) : (
        <p className={styles.note}>
          {answer.source === 'you' && <span className={styles.yours}>{t.yours}</span>}
          {answer.note}
          {answer.options.length > 0 && <span className={styles.options}> {t.options(answer.options)}</span>}
        </p>
      )}
    </li>
  )
}

export default function ApplicationPanel({ opportunityId, initial }: { opportunityId: string; initial: PreparedApplication | null }) {
  const t = useT()
  const a = t.opportunities.apply
  const [prepared, setPrepared] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function prepare() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId }),
      })
      const data = (await response.json().catch(() => ({}))) as PreparedApplication & { error?: string }
      if (!response.ok) throw new Error(data.error)
      setPrepared(data)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : a.failed)
    } finally {
      setBusy(false)
    }
  }

  if (busy) {
    return (
      <div className={styles.working} role="status">
        <Symbol size={28} watch breathe />
        <span>{a.working}</span>
      </div>
    )
  }

  if (!prepared) {
    return (
      <div className={styles.start}>
        <button type="button" className="btn" onClick={() => void prepare()}>
          {a.prepare}
        </button>
        <p className={styles.startLead}>{a.prepareLead}</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  const { advice } = prepared
  const yours = prepared.answers.filter((answer) => answer.source === 'you').length

  return (
    <details className={styles.panel} open>
      <summary className={styles.summary}>
        <span className={styles.summaryTitle}>{a.title}</span>
        <span className={styles.summaryMeta}>{a.summaryMeta(prepared.answers.length, yours)}</span>
      </summary>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{a.howTitle}</h4>
        <dl className={styles.advice}>
          <div>
            <dt>{a.channel}</dt>
            <dd>
              <strong>{a.channels[advice.channel]}.</strong> {advice.channelWhy}
            </dd>
          </div>
          <div>
            <dt>{a.cv}</dt>
            <dd>{advice.cv}</dd>
          </div>
          <div>
            <dt>{a.coverLetter}</dt>
            <dd>
              <strong>{a.letters[advice.coverLetter]}.</strong> {advice.coverLetterWhy}
            </dd>
          </div>
        </dl>
        {advice.emphasise.length > 0 && (
          <>
            <p className={styles.emphasiseLabel}>{a.emphasise}</p>
            <ul className={styles.emphasise}>
              {advice.emphasise.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {prepared.message && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{a.messageTitle}</h4>
          <div className={styles.letter}>
            <p>{prepared.message}</p>
            <CopyButton text={prepared.message} />
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{a.formTitle}</h4>
        <p className={styles.legend}>
          <span className={`${styles.dot} ${styles.dotFact}`} /> {a.legendFact}
          <span className={`${styles.dot} ${styles.dotRep}`} /> {a.legendRep}
          <span className={`${styles.dot} ${styles.dotYou}`} /> {a.legendYou}
        </p>
        <ul className={styles.fields}>
          {prepared.answers.map((answer) => (
            <Field key={answer.fieldId} answer={answer} />
          ))}
        </ul>
      </section>

      <div className={styles.footer}>
        <button type="button" className="text-btn" onClick={() => void prepare()}>
          {a.again}
        </button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}
