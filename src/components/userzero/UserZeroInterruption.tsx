'use client'

import { useState } from 'react'
import styles from '@/app/listening/listening.module.css'
import type { InterruptionView } from '@/lib/opportunity-view'
import type { CandidateResponse } from '@/domains/opportunity/types'
import { DEFAULT_LANGUAGE, type Language } from '@/lib/copy'

/** Las palabras de esta pantalla. El porqué y la evidencia vienen ya escritos. */
const WORDS = {
  es: {
    aria: 'Algo que ha encontrado tu Rep',
    kicker: 'He encontrado algo',
    posting: 'el anuncio →',
    whyShowing: 'Por qué te lo enseño',
    whyYou: 'Por qué tú',
    whatToConsider: 'Lo que no sé',
    hearThemOut: 'Que me cuenten',
    notForMe: 'No es para mí',
    note: 'Decidas lo que decidas, esto se queda entre tú y yo hasta que digas otra cosa.',
    failed: 'No ha salido. Prueba otra vez.',
    offline: 'Ahora mismo no hay conexión. No se ha enviado nada.',
  },
  en: {
    aria: 'Something your Rep found',
    kicker: 'Your Rep found something',
    posting: 'the posting →',
    whyShowing: "Why I'm showing you this",
    whyYou: 'Why you',
    whatToConsider: "What I don't know yet",
    hearThemOut: "I'll hear them out",
    notForMe: 'Not for me',
    note: 'Either way, this stays between us until you say otherwise.',
    failed: "That didn't go through. Try again.",
    offline: 'No connection right now. Nothing was sent.',
  },
} as const

/**
 * The one message the whole thing exists to send.
 *
 * Everything on this screen has to be traceable: why it is being shown
 * comes from what the person said they wanted, why them comes from the
 * evidence in their own Map, and what is still open stays open. There is no
 * match percentage and there never will be — the explanation is the
 * product, and a number is the thing you say instead of an explanation.
 */
export default function UserZeroInterruption({
  interruption,
  language = DEFAULT_LANGUAGE,
  onAnswered,
}: {
  interruption: InterruptionView
  language?: Language
  onAnswered: (response: CandidateResponse) => void
}) {
  const words = WORDS[language] ?? WORDS[DEFAULT_LANGUAGE]
  const [sending, setSending] = useState<CandidateResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  async function answer(response: CandidateResponse) {
    setSending(response)
    setFailed(null)
    try {
      const result = await fetch(`/api/opportunities/${interruption.opportunityId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      if (!result.ok) {
        setFailed(words.failed)
        setSending(null)
        return
      }
      onAnswered(response)
    } catch {
      setFailed(words.offline)
      setSending(null)
    }
  }

  return (
    <section className={styles.interruption} aria-label={words.aria}>
      <p className="kicker">{words.kicker}</p>
      <h1 className={styles.interruptionHeadline}>{interruption.headline}</h1>
      <p className={styles.interruptionRole}>
        {interruption.role} · {interruption.company}
        {interruption.url && (
          <>
            {' '}
            <a
              className={styles.interruptionLink}
              href={interruption.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {words.posting}
            </a>
          </>
        )}
      </p>

      {interruption.facts.length > 0 && (
        <dl className={styles.facts}>
          {interruption.facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className={styles.block}>
        <p className="kicker">{words.whyShowing}</p>
        <p className={styles.blockLead}>{interruption.whyShowing}</p>
      </div>

      {interruption.whyYou.length > 0 && (
        <div className={styles.block}>
          <p className="kicker">{words.whyYou}</p>
          <ul className={styles.claims}>
            {interruption.whyYou.map((claim, index) => (
              <li key={index} className={styles.claim}>
                <p className={styles.claimText}>{claim.text}</p>
                {/* The evidence itself, not a reference to it. Everything
                    said about someone here is checkable by them. */}
                <ul className={styles.evidence}>
                  {claim.evidence.map((statement, position) => (
                    <li key={position} className={styles.evidenceItem}>
                      {statement}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {interruption.whatToConsider.length > 0 && (
        <div className={styles.block}>
          <p className="kicker">{words.whatToConsider}</p>
          <ul className={styles.consider}>
            {interruption.whatToConsider.map((item, index) => (
              <li key={index} className={styles.considerItem}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.answer}>
        <button
          type="button"
          className={styles.answerPrimary}
          disabled={sending !== null}
          onClick={() => void answer('HEAR_THEM_OUT')}
        >
          {words.hearThemOut}
        </button>
        <button
          type="button"
          className={styles.answerSecondary}
          disabled={sending !== null}
          onClick={() => void answer('NOT_FOR_ME')}
        >
          {words.notForMe}
        </button>
      </div>
      <p className={styles.answerNote} role="status">
        {failed ?? words.note}
      </p>
    </section>
  )
}
