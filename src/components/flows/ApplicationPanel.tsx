'use client'

import { useState } from 'react'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
import type { PreparedAnswer, PreparedApplication } from '@/lib/apply/prepare'
import styles from '@/app/opportunities/application.module.css'

// "Prepare my application": how to apply, a message, and what of the form
// needs the candidate: what the Rep wrote for them to read, and what is
// theirs to decide. What the Rep fills in on its own is not shown.
//
// Preparing is held by the page, not by the card: it goes on while they move
// to another offer.

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

interface ApplicationPanelProps {
  prepared: PreparedApplication | null
  preparing: boolean
  error: string | null
  onPrepare: () => void
}

export default function ApplicationPanel({ prepared, preparing, error, onPrepare }: ApplicationPanelProps) {
  const a = useT().opportunities.apply

  if (preparing) {
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
        <button type="button" className={styles.prepare} onClick={onPrepare}>
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
  // What the Rep fills in on its own needs nothing from them.
  const shown = prepared.answers.filter((answer) => answer.source !== 'fact')
  const yours = shown.filter((answer) => answer.source === 'you').length

  return (
    <details className={styles.panel} open>
      <summary className={styles.summary}>
        <span className={styles.summaryTitle}>{a.title}</span>
        <span className={styles.summaryMeta}>{a.summaryMeta(yours)}</span>
      </summary>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{a.howTitle}</h4>
        <dl className={styles.advice}>
          <div>
            <dt>{a.cv}</dt>
            <dd>{advice.cv}</dd>
          </div>
          {advice.coverLetter !== 'skip' && (
            <div>
              <dt>{a.coverLetter}</dt>
              <dd>
                <strong>{a.letters[advice.coverLetter]}.</strong> {advice.coverLetterWhy}
              </dd>
            </div>
          )}
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

      {prepared.message && advice.coverLetter !== 'skip' && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{a.messageTitle}</h4>
          <div className={styles.letter}>
            <p>{prepared.message}</p>
            <CopyButton text={prepared.message} />
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{a.formTitle}</h4>
          <p className={styles.legend}>
            <span className={`${styles.dot} ${styles.dotRep}`} /> {a.legendRep}
            <span className={`${styles.dot} ${styles.dotYou}`} /> {a.legendYou}
          </p>
          <ul className={styles.fields}>
            {shown.map((answer) => (
              <Field key={answer.fieldId} answer={answer} />
            ))}
          </ul>
        </section>
      )}

      <div className={styles.footer}>
        <button type="button" className="text-btn" onClick={onPrepare}>
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
