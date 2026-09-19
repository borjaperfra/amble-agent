'use client'

import { useState } from 'react'
import styles from '@/app/listening/listening.module.css'
import type { InterruptionView } from '@/lib/opportunity-view'
import type { CandidateResponse } from '@/domains/opportunity/types'

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
  onAnswered,
}: {
  interruption: InterruptionView
  onAnswered: (response: CandidateResponse) => void
}) {
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
        setFailed("That didn't go through. Try again.")
        setSending(null)
        return
      }
      onAnswered(response)
    } catch {
      setFailed('No connection right now. Nothing was sent.')
      setSending(null)
    }
  }

  return (
    <section className={styles.interruption} aria-label="Something your Rep found">
      <p className="kicker">Your Rep found something</p>
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
              the posting →
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
        <p className="kicker">Why I&rsquo;m showing you this</p>
        <p className={styles.blockLead}>{interruption.whyShowing}</p>
      </div>

      {interruption.whyYou.length > 0 && (
        <div className={styles.block}>
          <p className="kicker">Why you</p>
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
          <p className="kicker">What I don&rsquo;t know yet</p>
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
          I&rsquo;ll hear them out
        </button>
        <button
          type="button"
          className={styles.answerSecondary}
          disabled={sending !== null}
          onClick={() => void answer('NOT_FOR_ME')}
        >
          Not for me
        </button>
      </div>
      <p className={styles.answerNote} role="status">
        {failed ?? 'Either way, this stays between us until you say otherwise.'}
      </p>
    </section>
  )
}
