'use client'

import Link from 'next/link'
import { useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useI18n, useT } from '@/components/I18nProvider'
import type { DiscardedOpportunity, FoundOpportunity, OpportunitiesView, WantedOpportunity } from '@/lib/matching/view'
import styles from '@/app/opportunities/opportunities.module.css'

type Response = 'interested' | 'not_for_me' | 'wanted_anyway'
type Progress = 'applied' | 'dropped' | null
export type Tab = 'new' | 'wanted' | 'sent' | 'aside'
const TABS: Tab[] = ['new', 'wanted', 'sent', 'aside']

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

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function markProgress(opportunityIds: string[], progress: Progress): Promise<boolean> {
  try {
    const result = await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportunityIds, progress }),
    })
    return result.ok
  } catch {
    return false
  }
}

export default function OpportunitiesFlow({ view: initial, tab: initialTab }: { view: OpportunitiesView; tab: Tab | null }) {
  const t = useT()
  // Without a tab asked for: what is new to answer first, else what they want.
  const [tab, setTab] = useState<Tab>(
    initialTab ?? (initial.found.some((item) => item.response === null) || initial.wanted.length === 0 ? 'new' : 'wanted'),
  )
  const [view, setView] = useState(initial)
  const [found, setFound] = useState(initial.found)
  const [maybe, setMaybe] = useState(initial.maybe)
  const [discarded, setDiscarded] = useState(initial.discarded)
  // The one that just moved up to "you want these", to mark its arrival.
  const [arrived, setArrived] = useState<string | null>(null)

  // Wanting an offer moves it up: the whole screen is read again, so it
  // arrives there with everything known about it.
  async function reload(movedTitle?: string) {
    try {
      const response = await fetch('/api/opportunities')
      if (!response.ok) return
      const next = (await response.json()) as OpportunitiesView
      setView(next)
      setFound(next.found)
      setMaybe(next.maybe)
      setDiscarded(next.discarded)
      if (movedTitle) setArrived(next.wanted.find((item) => item.title === movedTitle)?.key ?? null)
    } catch {
      // The answer is saved; the screen catches up on the next visit.
    }
  }

  const open = found.filter((item) => item.response === null)
  const answered = found.filter((item) => item.response !== null)

  const counts = {
    new: open.length + maybe.filter((item) => item.response === null).length,
    wanted: view.wanted.length,
    sent: view.sent.length,
    aside: discarded.length + view.dropped.length,
  }

  function choose(next: Tab) {
    setTab(next)
    // The tab is part of the address, so it can be linked and survives a reload.
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(null, '', url)
    } catch {
      // Without it the tab still changes; only the address does not follow.
    }
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <p className="kicker rep-kicker">
          <Symbol size={20} /> {t.opportunities.kicker}
        </p>
        <h1 className={styles.title}>{t.opportunities.title}</h1>

        <div className={styles.tabs} role="tablist" aria-label={t.opportunities.title}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => choose(key)}
            >
              {t.opportunities.tabs[key]}
              {/* What is new to answer is the one number that asks for attention. */}
              {key === 'new' ? (
                counts.new > 0 && (
                  <span className={styles.badge} key={`new-${counts.new}`} aria-label={t.opportunities.newCount(counts.new)}>
                    {counts.new}
                  </span>
                )
              ) : (
                <span className={styles.tabCount} key={`${key}-${counts[key]}`}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={styles.panel} key={tab}>
          {tab === 'new' && (
            <>
              {found.length === 0 && maybe.length === 0 && (
                <div className={styles.empty}>
                  <Symbol size={96} watch breathe label={t.listening.label} />
                  <p className={styles.emptyLine}>{t.opportunities.empty}</p>
                  <p className={styles.emptyLead}>{t.opportunities.emptyLead}</p>
                </div>
              )}

              {[...open, ...answered].map((item) => (
                <FoundCard
                  key={item.id}
                  item={item}
                  onAnswered={(response) => {
                    setFound((current) => current.map((entry) => (entry.id === item.id ? { ...entry, response } : entry)))
                    if (response === 'interested') void reload(item.title)
                  }}
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
                      onAnswered={(response) => {
                        setMaybe((current) => current.map((entry) => (entry.id === item.id ? { ...entry, response } : entry)))
                        if (response === 'interested') void reload(item.title)
                      }}
                    />
                  ))}
                </details>
              )}
            </>
          )}

          {tab === 'wanted' && (
            <>
              {view.wanted.length === 0 ? (
                <p className={styles.panelEmpty}>{t.opportunities.wanted.empty}</p>
              ) : (
                <>
                  <p className={styles.wantedLead}>{t.opportunities.wanted.lead}</p>
                  {view.wanted.map((item) => (
                    <WantedCard
                      key={item.key}
                      item={item}
                      arrived={arrived === item.key}
                      onChanged={() => void reload()}
                    />
                  ))}
                </>
              )}

            </>
          )}

          {tab === 'sent' &&
            (view.sent.length === 0 ? (
              <p className={styles.panelEmpty}>{t.opportunities.wanted.sentEmpty}</p>
            ) : (
              <>
                <p className={styles.wantedLead}>{t.opportunities.wanted.sentLead}</p>
                {view.sent.map((item) => (
                  <WantedCard key={item.key} item={item} arrived={false} onChanged={() => void reload()} />
                ))}
              </>
            ))}

          {tab === 'aside' && (
            <>
              {view.dropped.length > 0 && (
                <section className={styles.droppedSection}>
                  <h2 className={styles.sectionTitle}>{t.opportunities.wanted.droppedTitle}</h2>
                  <ul className={styles.discardedList}>
                    {view.dropped.map((item) => (
                      <DroppedItem key={item.key} item={item} onChanged={() => void reload()} />
                    ))}
                  </ul>
                </section>
              )}
              {discarded.length === 0 ? (
                view.dropped.length === 0 && <p className={styles.panelEmpty}>{t.opportunities.asideEmpty}</p>
              ) : (
                <>
                  {view.dropped.length > 0 && <h2 className={styles.sectionTitle}>{t.opportunities.bySetAside}</h2>}
                  <p className={styles.discardedLead}>{t.opportunities.discardedLead}</p>
                  <ul className={styles.discardedList}>
                    {discarded.map((item) => (
                      <DiscardedItem
                        key={item.id}
                        item={item}
                        onWanted={() => {
                          setDiscarded((current) =>
                            current.map((entry) => (entry.id === item.id ? { ...entry, response: 'wanted_anyway' } : entry)),
                          )
                          void reload(item.title)
                        }}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

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
      <p className={styles.cardKicker}>
        <Symbol size={20} /> {t.opportunities.worthHearing}
      </p>
      <h2 className={styles.cardTitle}>{item.title}</h2>
      <p className={styles.meta}>{meta}</p>
      {item.salary && <p className={styles.salary}>{item.salary}</p>}
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

// An offer they want: what is still unknown, what could make it a no, and
// the next step. Applied or dropped is theirs to say; nothing is assumed.
// Sent: a stamp pressed onto the card. Dropped: the title crossed out by hand,
// then the card folds away. Both are shown before the screen catches up.
const STAMP_MS = 1100
const STRIKE_MS = 560
const FOLD_MS = 720

function WantedCard({ item, arrived, onChanged }: { item: WantedOpportunity; arrived: boolean; onChanged: () => void }) {
  const { t, locale } = useI18n()
  const w = t.opportunities.wanted
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What was just done here, so it can be shown before the screen reloads.
  const [moment, setMoment] = useState<'stamped' | 'striking' | 'folding' | null>(null)
  const meta = [item.company, item.location, item.workplace].filter(Boolean).join(' · ')
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date(item.since))
  const applied = item.progress === 'applied' || moment === 'stamped' || (moment === 'folding' && item.progress === null)
  const calm = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  async function mark(progress: Progress) {
    setBusy(true)
    setError(null)
    if (!(await markProgress(item.opportunityIds, progress))) {
      setError(t.opportunities.responseFailed)
      setBusy(false)
      return
    }
    if (progress === 'applied' && !calm()) {
      setMoment('stamped')
      await wait(STAMP_MS)
      setMoment('folding')
      await wait(FOLD_MS)
    } else if (progress === 'dropped' && !calm()) {
      setMoment('striking')
      await wait(STRIKE_MS)
      setMoment('folding')
      await wait(FOLD_MS)
    } else {
      setMoment(null)
    }
    setBusy(false)
    onChanged()
  }

  const cardClass = [
    styles.wantedCard,
    arrived ? styles.arrived : '',
    moment === 'striking' || moment === 'folding' ? styles.striking : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={moment === 'folding' ? `${styles.fold} ${styles.folding}` : styles.fold}>
      <article className={cardClass}>
        {applied && (
          <span className={moment === 'stamped' ? `${styles.stamp} ${styles.pressing}` : styles.stamp} aria-hidden="true">
            {w.stamp}
          </span>
        )}
        <p className={applied ? `${styles.state} ${styles.stateApplied}` : styles.state}>
          {applied ? w.applied(moment === 'stamped' ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date()) : date) : w.interested}
        </p>
        <h3 className={styles.cardTitle}>
          <span className={styles.strikeable}>{item.title}</span>
        </h3>
        <p className={styles.meta}>{meta}</p>
        {item.salary && <p className={styles.salary}>{item.salary}</p>}
        {item.closed && <p className={styles.closed}>{t.opportunities.closed}</p>}
        {item.summary && <p className={styles.wantedSummary}>{item.summary}</p>}

        {item.progress !== 'applied' && item.unknowns.length > 0 && (
          <section className={styles.block}>
            <h4 className={styles.blockLabel}>{w.unknownsTitle}</h4>
            <p className={styles.blockLead}>{w.unknownsLead}</p>
            <ul className={styles.unknowns}>
              {item.unknowns.map((unknown) => (
                <li key={unknown}>{unknown}</li>
              ))}
            </ul>
          </section>
        )}

        {item.progress !== 'applied' && item.considerAlso && (
          <section className={styles.block}>
            <h4 className={styles.blockLabel}>{w.considerTitle}</h4>
            <p className={styles.consider}>{item.considerAlso.text}</p>
          </section>
        )}

        <div className={styles.wantedActions}>
          {item.url && !item.closed && (
            <a className="btn" href={item.url} target="_blank" rel="noreferrer">
              {w.goTo}
            </a>
          )}
          {item.progress === 'applied' ? (
            <button type="button" className="text-btn" disabled={busy} onClick={() => void mark(null)}>
              {w.undo}
            </button>
          ) : (
            <button type="button" className={styles.appliedBtn} disabled={busy} onClick={() => void mark('applied')}>
              {w.markApplied}
            </button>
          )}
          <button type="button" className="text-btn" disabled={busy} onClick={() => void mark('dropped')}>
            {w.drop}
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </article>
    </div>
  )
}

function DroppedItem({ item, onChanged }: { item: WantedOpportunity; onChanged: () => void }) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  return (
    <li className={styles.discardedItem}>
      <p className={styles.discardedTitle}>
        {item.title} <span className={styles.meta}>· {item.company}</span>
      </p>
      <button
        type="button"
        className={styles.wantedBtn}
        onClick={async () => {
          setError(null)
          if (await markProgress(item.opportunityIds, null)) onChanged()
          else setError(t.opportunities.responseFailed)
        }}
      >
        {t.opportunities.wanted.resume}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </li>
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
            : reason.kind === 'below_level'
              ? t.opportunities.belowLevel(reason.text)
              : reason.kind === 'filter'
              ? t.opportunities.brokeFilter(reason.rule)
              : reason.kind === 'salary_floor'
              ? t.opportunities.belowFloor
              : reason.kind === 'language'
              ? t.opportunities.requiredLanguage
              : reason.kind === 'remote_unconfirmed'
              ? t.opportunities.remoteUnconfirmed
              : reason.kind === 'remote_elsewhere'
              ? t.opportunities.remoteElsewhere
              : reason.kind === 'remote_countries'
              ? t.opportunities.remoteCountries
              : t.opportunities.notEnoughReasons}
          {(reason.kind === 'filter' || reason.kind === 'salary_floor' || reason.kind === 'language') && reason.quote && (
            <span className={styles.discardQuote}> — “{reason.quote}”</span>
          )}
          {(reason.kind === 'remote_unconfirmed' || reason.kind === 'remote_elsewhere' || reason.kind === 'remote_countries') && reason.places && (
            <span className={styles.discardQuote}> — {reason.places}</span>
          )}
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
