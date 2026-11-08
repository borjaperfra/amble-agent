'use client'

import { useEffect, useRef, useState } from 'react'
import Symbol from '@/components/Symbol'
import LiveForm from '@/components/flows/LiveForm'
import FormAnswers, { CopyButton, type Edits } from '@/components/flows/FormAnswers'
import { applicationAction as post, requestJson } from '@/components/api'
import { useT } from '@/components/I18nProvider'
import type { PreparedAnswer, PreparedApplication } from '@/lib/apply/prepare'
import styles from '@/app/opportunities/application.module.css'

// "Prepare my application": how to apply, a message, and what of the form
// needs the candidate: what the Rep wrote for them to read, and what is
// theirs to answer, kept for the next form that asks the same. Then the Rep
// fills the form in a browser, shows it, and sends it only when they say so.
//
// Preparing is held by the page, not by the card: it goes on while they move
// to another offer.

// The same normalisation the server uses to key saved answers.
function questionKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function CvField({ cv, onUploaded }: { cv: string | null; onUploaded: (name: string) => void }) {
  const t = useT().opportunities.apply
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={styles.cv}>
      {cv ? <span className={styles.cvName}>{cv}</span> : <span className={styles.note}>{t.cvMissing}</span>}
      <button type="button" className={styles.copy} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t.uploading : cv ? t.cvChange : t.cvUpload}
      </button>
      <input
        ref={input}
        type="file"
        accept=".pdf,.doc,.docx"
        className="visually-hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          setBusy(true)
          setError(null)
          const form = new FormData()
          form.append('file', file)
          const { ok, data } = await requestJson<{ filename?: string }>('/api/applications/cv', { method: 'POST', body: form })
          if (ok && data.filename) onUploaded(data.filename)
          else setError(data.error || t.failed)
          setBusy(false)
        }}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// A long part of the application, folded until they ask for it: on a phone
// the letter and the form together are several screens. Folded, it is only
// hidden, so nothing inside is lost or reset.
function Fold({ id, title, summary, children, initiallyOpen = false }: { id: string; title: string; summary: React.ReactNode; children: React.ReactNode; initiallyOpen?: boolean }) {
  const a = useT().opportunities.apply
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <section className={styles.section}>
      <div className={styles.foldHead}>
        <h4 className={styles.sectionTitle}>{title}</h4>
        <button type="button" className={styles.foldToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
          {open ? a.hide : a.show}
          <span className="visually-hidden"> {title}</span>
        </button>
      </div>
      {!open && summary}
      <div id={id} className={styles.foldBody} hidden={!open}>
        {children}
      </div>
    </section>
  )
}

type Stage =
  | { step: 'review' }
  | { step: 'filling' }
  | { step: 'window'; left: string[]; live: boolean }
  | { step: 'closed' }
  | { step: 'filled'; left: string[]; captcha: boolean; shot: number }
  | { step: 'sending' }
  | { step: 'blocked'; reason: 'captcha' | 'rejected' | 'unclear' | 'expired' }

interface ApplicationPanelProps {
  opportunityId: string
  company: string
  url: string | null
  prepared: PreparedApplication | null
  preparing: boolean
  error: string | null
  onPrepare: () => void
  applicant: { cv: string | null; answers: Record<string, string>; canFill: boolean }
  onSent: () => void
}

export default function ApplicationPanel({ opportunityId, company, url, prepared, preparing, error, onPrepare, applicant, onSent }: ApplicationPanelProps) {
  const a = useT().opportunities.apply
  const [saved] = useState(applicant.answers)
  const [cv, setCv] = useState(applicant.cv)
  const [stage, setStage] = useState<Stage>({ step: 'review' })
  const [problem, setProblem] = useState<string | null>(null)
  // What they changed in an answer, to copy it (#49): kept through every step.
  const [edits, setEdits] = useState<Edits>({})
  // Each new picture of the form, so the browser does not show the last one.
  const shots = useRef(0)
  // The look at the window they fill themselves ends when the panel goes.
  const watching = useRef(0)
  useEffect(() => () => window.clearInterval(watching.current), [])

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
  // What is left for them to fill in the form itself (the CV is not: it goes).
  // The form's questions, as listed (the CV has its own line).
  const fields = shown.filter((answer) => answer.kind !== 'resume')
  const yours = shown.filter((answer) => answer.source === 'you' && answer.kind !== 'resume' && !saved[questionKey(answer.label)]).length
  // As text, to copy into the offer's own form (#49): every answer, what
  // amble fills on its own too (their name, their email), the CV aside.
  const textAnswers = prepared.answers.filter((answer) => answer.kind !== 'resume')
  const answersText = (lead?: string) => (
    <FormAnswers
      answers={textAnswers}
      edits={edits}
      onEdit={(fieldId, text) => setEdits((value) => ({ ...value, [fieldId]: text }))}
      savedOf={(answer: PreparedAnswer) => saved[questionKey(answer.label)]}
      url={url}
      lead={lead}
    />
  )
  // Beside what amble filled: the same answers, to copy.
  const answersBeside =
    textAnswers.length > 0 ? (
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{a.answersTitle}</h4>
        {answersText(a.answersFilledLead)}
      </section>
    ) : null

  async function fill() {
    setProblem(null)
    setStage({ step: 'filling' })
    try {
      const result = (await post({ action: 'fill', opportunityId })) as {
        status: string
        left?: string[]
        captcha?: boolean
        window?: boolean
        live?: boolean
        missing?: string[]
        reason?: string
      }
      if (result.status === 'filled' && result.window) {
        setStage({ step: 'window', left: result.left ?? [], live: Boolean(result.live) })
        // In the cloud the live view looks for itself.
        if (!result.live) watch()
      } else if (result.status === 'filled') setStage({ step: 'filled', left: result.left ?? [], captcha: Boolean(result.captcha), shot: ++shots.current })
      else {
        setProblem(result.status === 'missing' ? a.stillMissing((result.missing ?? []).join(' · ')) : a.cannotFill)
        setStage({ step: 'review' })
      }
    } catch {
      setProblem(a.fillFailed)
      setStage({ step: 'review' })
    }
  }

  // The window is theirs: every few seconds, whether they sent it or closed it.
  function watch() {
    window.clearInterval(watching.current)
    const timer = window.setInterval(async () => {
      try {
        const { state } = (await post({ action: 'status', opportunityId })) as { state: string }
        if (state === 'sent') {
          window.clearInterval(timer)
          onSent()
        } else if (state === 'closed' || state === 'none') {
          window.clearInterval(timer)
          setStage({ step: 'closed' })
        }
      } catch {
        // A missed look; the next one tells.
      }
    }, 3000)
    watching.current = timer
  }

  async function send() {
    setStage({ step: 'sending' })
    try {
      const result = (await post({ action: 'submit', opportunityId, confirm: true })) as { status: string; reason?: 'captcha' | 'rejected' | 'unclear' }
      if (result.status === 'sent') onSent()
      else setStage({ step: 'blocked', reason: result.status === 'expired' ? 'expired' : (result.reason ?? 'unclear') })
    } catch {
      setStage({ step: 'blocked', reason: 'unclear' })
    }
  }

  if (stage.step === 'filling' || stage.step === 'sending') {
    return (
      <div className={styles.working} role="status">
        <Symbol size={28} watch breathe />
        <span>{stage.step === 'filling' ? a.filling : a.sending(company)}</span>
      </div>
    )
  }

  if (stage.step === 'window' && stage.live) {
    return (
      <>
        <LiveForm opportunityId={opportunityId} company={company} left={stage.left} onSent={onSent} onClosed={() => setStage({ step: 'closed' })} />
        {answersBeside}
      </>
    )
  }

  if (stage.step === 'window') {
    return (
      <section className={styles.review} role="status">
        <p className={styles.windowLine}>
          <Symbol size={28} watch breathe />
          <span>{a.windowOpen(company)}</span>
        </p>
        {stage.left.length > 0 && (
          <>
            <p className={styles.reviewLead}>{a.windowLeft}</p>
            <ul className={styles.leftList}>
              {stage.left.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </>
        )}
        <p className={styles.note}>{a.windowWatch}</p>
        {answersBeside}
      </section>
    )
  }

  if (stage.step === 'closed') {
    return (
      <section className={styles.review}>
        <p className={styles.warning}>{a.windowClosed}</p>
        <div className={styles.reviewActions}>
          <button type="button" className="btn" onClick={() => void fill()}>
            {a.reopen}
          </button>
        </div>
      </section>
    )
  }

  if (stage.step === 'filled') {
    return (
      <section className={styles.review}>
        <h4 className={styles.reviewTitle}>{a.reviewTitle}</h4>
        <p className={styles.reviewLead}>{a.reviewLead}</p>
        {stage.left.length > 0 && <p className={styles.note}>{a.left(stage.left.join(' · '))}</p>}
        {stage.captcha && <p className={styles.warning}>{a.captchaAhead}</p>}
        <div className={styles.shot}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, generated screenshot */}
          <img src={`/api/applications?screenshot=filled&opportunityId=${encodeURIComponent(opportunityId)}&t=${stage.shot}`} alt={a.shotAlt(company)} />
        </div>
        <div className={styles.reviewActions}>
          <button type="button" className="btn" onClick={() => void send()}>
            {a.send(company)}
          </button>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              void post({ action: 'cancel', opportunityId }).catch(() => undefined)
              setStage({ step: 'review' })
            }}
          >
            {a.notYet}
          </button>
        </div>
        {answersBeside}
      </section>
    )
  }

  if (stage.step === 'blocked') {
    return (
      <section className={styles.review}>
        <p className={styles.warning}>{a.blocked[stage.reason]}</p>
        <div className={styles.reviewActions}>
          {url && (
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              {a.finishYourself}
            </a>
          )}
          <button type="button" className="text-btn" onClick={() => setStage({ step: 'review' })}>
            {a.back}
          </button>
        </div>
      </section>
    )
  }

  return (
    <details className={styles.panel} open>
      <summary className={styles.summary}>
        <span className={styles.summaryTitle}>{a.title}</span>
        <span className={styles.summaryMeta}>{yours > 0 ? a.missingMeta(yours) : a.readyMeta}</span>
      </summary>

      <Fold
        id={`apply-${opportunityId}-how`}
        title={a.howTitle}
        summary={
          <p className={styles.foldPreview} aria-hidden="true">
            {advice.cv}
          </p>
        }
      >
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
      </Fold>

      {prepared.message && advice.coverLetter !== 'skip' && (
        <Fold
          id={`apply-${opportunityId}-letter`}
          title={a.messageTitle}
          summary={
            <p className={styles.foldPreview} aria-hidden="true">
              {prepared.message}
            </p>
          }
        >
          <div className={styles.letter}>
            <p>{prepared.message}</p>
            <CopyButton text={prepared.message} />
          </div>
        </Fold>
      )}

      {fields.length > 0 && (
        <Fold
          id={`apply-${opportunityId}-form`}
          title={a.formTitle}
          // Without a browser here, these are what they copy: open from the start.
          initiallyOpen={!applicant.canFill}
          summary={<p className={styles.note}>{a.formCount(fields.length, fields.filter((answer) => answer.source === 'you').length)}</p>}
        >
          <p className={styles.legend}>
            <span className={`${styles.dot} ${styles.dotRep}`} /> {a.legendRep}
            <span className={`${styles.dot} ${styles.dotYou}`} /> {a.legendYou}
          </p>
          {answersText()}
        </Fold>
      )}

      <div className={styles.cvLine}>
        <span className={styles.note}>{cv ? a.cvUsed(cv) : a.cvMissing}</span>
        <CvField cv={cv} onUploaded={setCv} />
      </div>

      {/* Without a browser here, they copy it into the offer's form themselves. */}
      {applicant.canFill ? (
        <div className={styles.fillBar}>
          <button type="button" className="btn" onClick={() => void fill()}>
            {a.fill}
          </button>
          <p className={styles.fillLead}>{a.fillLead}</p>
        </div>
      ) : (
        <p className={styles.fillLead}>{a.finishThere}</p>
      )}
      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
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
