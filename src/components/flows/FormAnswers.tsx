'use client'

import { useState } from 'react'
import { useT } from '@/components/I18nProvider'
import type { PreparedAnswer } from '@/lib/apply/prepare'
import styles from '@/app/opportunities/application.module.css'

// The form's answers as text (#49): each one to edit and copy, and all of
// them at once, to take into the offer's own form by hand. The live view and
// the picture of the filled form are a remote browser and an image: nothing
// in them can be selected, least of all on a phone. What they change here is
// for copying; it does not change the form amble filled.

export function CopyButton({ text, label }: { text: string; label?: { copy: string; copied: string } }) {
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
      {copied ? (label ?? t).copied : (label ?? t).copy}
    </button>
  )
}

// What each answer reads now: what they wrote here, else what amble wrote or
// they saved before.
export type Edits = Record<string, string>

export function answerValue(answer: PreparedAnswer, edits: Edits, saved: string | undefined): string {
  return edits[answer.fieldId] ?? answer.answer ?? saved ?? ''
}

// Every answer with its question, as one text to paste.
export function allAnswersText(answers: PreparedAnswer[], value: (answer: PreparedAnswer) => string): string {
  return answers
    .map((answer) => ({ label: answer.label, text: value(answer).trim() }))
    .filter((item) => item.text)
    .map((item) => `${item.label}\n${item.text}`)
    .join('\n\n')
}

export default function FormAnswers({
  answers,
  edits,
  onEdit,
  savedOf,
  url,
  lead,
}: {
  answers: PreparedAnswer[]
  edits: Edits
  onEdit: (fieldId: string, text: string) => void
  savedOf: (answer: PreparedAnswer) => string | undefined
  url: string | null
  lead?: string
}) {
  const a = useT().opportunities.apply
  const value = (answer: PreparedAnswer) => answerValue(answer, edits, savedOf(answer))
  const all = allAnswersText(answers, value)
  return (
    <div className={styles.answers}>
      {lead && <p className={styles.note}>{lead}</p>}
      <ul className={styles.fields}>
        {answers.map((answer) => {
          const id = `answer-${answer.fieldId}`
          const text = value(answer)
          return (
            <li key={answer.fieldId} className={`${styles.field} ${styles[answer.source]}`}>
              <label className={styles.fieldLabel} htmlFor={id}>
                {answer.label}
                {answer.required && <span className={styles.required} aria-label={a.required}> *</span>}
              </label>
              <div className={styles.fieldAnswer}>
                <textarea
                  id={id}
                  className={styles.answerEdit}
                  value={text}
                  rows={Math.min(8, Math.max(1, Math.ceil(text.length / 48) + (text.match(/\n/g)?.length ?? 0)))}
                  placeholder={answer.source === 'you' ? (answer.note ?? a.youInForm) : undefined}
                  onChange={(event) => onEdit(answer.fieldId, event.target.value)}
                />
                {text.trim() && <CopyButton text={text} />}
              </div>
            </li>
          )
        })}
      </ul>
      <div className={styles.reviewActions}>
        {all && <CopyButton text={all} label={{ copy: a.copyAll, copied: a.copied }} />}
        {url && (
          <a className="text-btn" href={url} target="_blank" rel="noreferrer">
            {a.finishYourself}
          </a>
        )}
      </div>
    </div>
  )
}
