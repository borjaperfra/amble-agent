'use client'

import Link from 'next/link'
import { useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import { useT } from '@/components/I18nProvider'
import type { DiscardedOpportunity, FoundOpportunity, OpportunitiesView } from '@/lib/matching/view'
import styles from '@/app/opportunities/opportunities.module.css'

type Response = 'interested' | 'not_for_me' | 'wanted_anyway'

async function respond(matchId: string, response: Response, reason?: string): Promise<boolean> {
  try {
    const result = await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, response, reason }),
    })
    return result.ok
  } catch {
    return false
  }
}

export default function OpportunitiesFlow({ view }: { view: OpportunitiesView }) {
  const t = useT()
  const [found, setFound] = useState(view.found)
  const [maybe, setMaybe] = useState(view.maybe)
  const [discarded, setDiscarded] = useState(view.discarded)

  const open = found.filter((item) => item.response === null)
  const answered = found.filter((item) => item.response !== null)

  return (
    <>
      <Header />
      <main className={styles.page}>
        <p className="kicker">{t.opportunities.kicker}</p>
        <h1 className={styles.title}>{t.opportunities.title}</h1>

        {found.length === 0 && maybe.length === 0 && (
          <div className={styles.empty}>
            <StatusDot label={t.listening.label} />
            <p className={styles.emptyLine}>{t.opportunities.empty}</p>
            <p className={styles.emptyLead}>{t.opportunities.emptyLead}</p>
          </div>
        )}

        {[...open, ...answered].map((item) => (
          <FoundCard
            key={item.id}
            item={item}
            onAnswered={(response) =>
              setFound((current) => current.map((entry) => (entry.id === item.id ? { ...entry, response } : entry)))
            }
          />
        ))}

        {maybe.length > 0 && (
          <details className={styles.discarded} open={found.length === 0}>
            <summary className={styles.discardedSummary}>
              {t.opportunities.maybeTitle} ({maybe.length})
            </summary>
            <p className={styles.discardedLead}>{t.opportunities.maybeLead}</p>
            {maybe.map((item) => (
              <FoundCard
                key={item.id}
                item={item}
                onAnswered={(response) =>
                  setMaybe((current) => current.map((entry) => (entry.id === item.id ? { ...entry, response } : entry)))
                }
              />
            ))}
          </details>
        )}

        {discarded.length > 0 && (
          <details className={styles.discarded}>
            <summary className={styles.discardedSummary}>
              {t.opportunities.discardedTitle} ({discarded.length})
            </summary>
            <p className={styles.discardedLead}>{t.opportunities.discardedLead}</p>
            <ul className={styles.discardedList}>
              {discarded.map((item) => (
                <DiscardedItem
                  key={item.id}
                  item={item}
                  onWanted={() =>
                    setDiscarded((current) =>
                      current.map((entry) => (entry.id === item.id ? { ...entry, response: 'wanted_anyway' } : entry)),
                    )
                  }
                />
              ))}
            </ul>
          </details>
        )}

        <div className={styles.footer}>
          <Link href="/listening" className="text-btn">
            {t.triage.backToListening}
          </Link>
        </div>
      </main>
    </>
  )
}

function FoundCard({ item, onAnswered }: { item: FoundOpportunity; onAnswered: (response: Response) => void }) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const meta = [item.company, item.location, item.workplace].filter(Boolean).join(' · ')

  async function answer(response: Response, withReason?: string) {
    setError(null)
    if (await respond(item.id, response, withReason)) {
      setAsking(false)
      onAnswered(response)
    } else {
      setError(t.opportunities.responseFailed)
    }
  }

  return (
    <article className={styles.card} data-answered={item.response !== null}>
      <p className={styles.cardKicker}>{t.opportunities.worthHearing}</p>
      <h2 className={styles.cardTitle}>{item.title}</h2>
      <p className={styles.meta}>{meta}</p>
      {item.closed && <p className={styles.closed}>{t.opportunities.closed}</p>}
      <p className={styles.summary}>{item.summary}</p>

      <section className={styles.block}>
        <h3 className={styles.blockLabel}>{t.opportunities.whyShowing}</h3>
        <ul className={styles.reasons}>
          {item.why.map((reason) => (
            <li key={reason.text} className={styles.reason}>
              <p>{reason.text}</p>
              {reason.evidence && <p className={styles.evidence}>{reason.evidence}</p>}
              {reason.quote && <blockquote className={styles.quote}>“{reason.quote}”</blockquote>}
            </li>
          ))}
        </ul>
      </section>

      {(item.considerAlso || item.fit === 'stretch') && (
        <section className={styles.block}>
          <h3 className={styles.blockLabel}>{t.opportunities.considerAlso}</h3>
          {item.considerAlso ? (
            <>
              <p className={styles.consider}>{item.considerAlso.text}</p>
              {item.considerAlso.quote && <blockquote className={styles.quote}>“{item.considerAlso.quote}”</blockquote>}
            </>
          ) : (
            <p className={styles.consider}>{t.opportunities.stretch}</p>
          )}
        </section>
      )}

      {item.unknowns.length > 0 && (
        <section className={styles.block}>
          <h3 className={styles.blockLabel}>{t.opportunities.unknowns}</h3>
          <ul className={styles.unknowns}>
            {item.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        </section>
      )}

      {item.url && (
        <a className={`text-btn ${styles.posting}`} href={item.url} target="_blank" rel="noreferrer">
          {t.opportunities.viewPosting}
        </a>
      )}

      {item.response === null && !asking && (
        <div className={styles.actions}>
          <button type="button" className="btn" onClick={() => void answer('interested')}>
            {t.opportunities.interested}
          </button>
          <button type="button" className="text-btn" onClick={() => setAsking(true)}>
            {t.opportunities.notForMe}
          </button>
        </div>
      )}

      {/* DESIGN_SYSTEM §24: ask what to learn, without forcing feedback. */}
      {item.response === null && asking && (
        <div className={styles.learn}>
          <label className={styles.learnLabel} htmlFor={`learn-${item.id}`}>
            {t.opportunities.learnPrompt}
          </label>
          <textarea
            id={`learn-${item.id}`}
            className={styles.textarea}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={() => void answer('not_for_me', reason)}>
              {t.opportunities.learnSend}
            </button>
            <button type="button" className="text-btn" onClick={() => void answer('not_for_me')}>
              {t.opportunities.skip}
            </button>
          </div>
        </div>
      )}

      {item.response !== null && (
        <p className={styles.saved} role="status">
          {item.response === 'interested' ? t.opportunities.savedInterested : t.opportunities.savedNotForMe}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </article>
  )
}

function DiscardedItem({ item, onWanted }: { item: DiscardedOpportunity; onWanted: () => void }) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)

  return (
    <li className={styles.discardedItem}>
      <p className={styles.discardedTitle}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          item.title
        )}{' '}
        <span className={styles.meta}>· {item.company}</span>
      </p>
      {item.reasons.map((reason, index) => (
        <p key={index} className={styles.discardReason}>
          {reason.kind === 'wrong_role'
            ? t.opportunities.wrongRole(reason.text)
            : reason.kind === 'filter'
              ? t.opportunities.brokeFilter(reason.rule)
              : t.opportunities.notEnoughReasons}
          {reason.kind === 'filter' && reason.quote && <span className={styles.discardQuote}> — “{reason.quote}”</span>}
        </p>
      ))}
      {item.response === 'wanted_anyway' ? (
        <p className={styles.saved} role="status">
          {t.opportunities.savedWanted}
        </p>
      ) : (
        <button
          type="button"
          className={styles.wantedBtn}
          onClick={async () => {
            setError(null)
            if (await respond(item.id, 'wanted_anyway')) onWanted()
            else setError(t.opportunities.responseFailed)
          }}
        >
          {t.opportunities.wantedAnyway}
        </button>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
