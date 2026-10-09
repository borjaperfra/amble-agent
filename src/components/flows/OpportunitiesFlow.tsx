'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Header from '@/components/Header'
import Deck from '@/components/Deck'
import ApplicationPanel from '@/components/flows/ApplicationPanel'
import WhatsAppConnect from '@/components/flows/WhatsAppConnect'
import DroughtNote from '@/components/DroughtNote'
import Symbol from '@/components/Symbol'
import { useI18n, useT } from '@/components/I18nProvider'
import { postJson, requestJson } from '@/components/api'
import type { PreparedApplication } from '@/lib/apply/prepare'
import type { DiscardedOpportunity, FoundOpportunity, OpportunitiesView, WantedOpportunity } from '@/lib/matching/view'
import { estimateRange, estimateSource } from '@/lib/salary/format'
import type { ShownEstimate } from '@/lib/salary/estimate'
import styles from '@/app/opportunities/opportunities.module.css'

type Response = 'interested' | 'not_for_me' | 'wanted_anyway' | 'already_applied'

// Offers answered here before the Rep asks to carry on on WhatsApp.
const HANDOFF_AFTER = 5
const HANDOFF_KEY = 'amble-whatsapp-handoff-stayed'
type Progress = 'applied' | 'dropped' | null
export type Tab = 'new' | 'wanted' | 'sent' | 'aside'
const TABS: Tab[] = ['new', 'wanted', 'sent', 'aside']

async function respond(matchId: string, response: Response, reason?: string): Promise<boolean> {
  return (await postJson('/api/opportunities', { matchId, response, reason })).ok
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function markProgress(opportunityIds: string[], progress: Progress): Promise<boolean> {
  return (await postJson('/api/opportunities', { opportunityIds, progress })).ok
}

// Offers set aside, shown this many at a time.
const ASIDE_PAGE = 20

// paused: they paused the search, so the empty page does not say it is listening.
export default function OpportunitiesFlow({ view: initial, tab: initialTab, paused }: { view: OpportunitiesView; tab: Tab | null; paused: boolean }) {
  const t = useT()
  const [view, setView] = useState(initial)
  const pending = (items: FoundOpportunity[]) => items.filter((item) => item.response === null)
  // Without a tab asked for: what is new to answer first, else what they want.
  const [tab, setTab] = useState<Tab>(
    initialTab ?? (pending(initial.found).length > 0 || initial.wanted.length === 0 ? 'new' : 'wanted'),
  )
  // Applications being prepared, by the page: they go on while the candidate
  // moves to another offer, and a note says when one is ready.
  const [preparing, setPreparing] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, PreparedApplication>>({})
  const [prepareErrors, setPrepareErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ text: string; key: string } | null>(null)
  // Ready to read, until they open it: offer key to its title.
  const [ready, setReady] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<string | null>(null)
  // What was set aside can run to hundreds: a page of them at a time.
  const [asideShown, setAsideShown] = useState(ASIDE_PAGE)

  const newDeck = [...pending(view.found), ...pending(view.maybe)]

  // The WhatsApp offer, after the first few answers, until they choose to
  // carry on here (remembered on this device).
  const [stayed, setStayed] = useState(false)
  useEffect(() => {
    let remembered = false
    try {
      remembered = window.localStorage.getItem(HANDOFF_KEY) !== null
    } catch {
      // Without storage it is offered again on the next visit.
    }
    // Read after the first paint, which the server rendered without it.
    const id = window.setTimeout(() => setStayed(remembered), 0)
    return () => window.clearTimeout(id)
  }, [])
  const handoff = !stayed && view.whatsapp.available && !view.whatsapp.linked && view.decided >= HANDOFF_AFTER

  // What replaced the card (the next one, the WhatsApp offer, the end of the
  // pile) is read from its top: the page does not stay down where the last
  // card's answers were.
  const panelRef = useRef<HTMLDivElement>(null)
  function toPanel() {
    const panel = panelRef.current
    if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function stayHere() {
    setStayed(true)
    try {
      window.localStorage.setItem(HANDOFF_KEY, '1')
    } catch {
      // Remembered for this visit only.
    }
    window.requestAnimationFrame(toPanel)
  }

  async function reload() {
    // If it fails, the answer is saved anyway; the screen catches up on the next visit.
    const { ok, data } = await requestJson<OpportunitiesView>('/api/opportunities')
    if (ok) setView(data)
  }

  async function prepare(item: WantedOpportunity) {
    const id = item.opportunityIds[0]
    setPreparing((current) => ({ ...current, [id]: true }))
    setPrepareErrors((current) => ({ ...current, [id]: '' }))
    const { ok, data } = await postJson<PreparedApplication>('/api/applications', { opportunityId: id })
    if (ok) {
      setDrafts((current) => ({ ...current, [id]: data }))
      setReady((current) => ({ ...current, [item.key]: item.title }))
    } else {
      setPrepareErrors((current) => ({ ...current, [id]: data.error || t.opportunities.apply.failed }))
    }
    setPreparing((current) => ({ ...current, [id]: false }))
  }

  const preparingItems = view.wanted.filter((item) => preparing[item.opportunityIds[0]])

  const counts = {
    new: newDeck.length,
    wanted: view.wanted.length,
    sent: view.sent.length,
    aside: view.discarded.length + view.dropped.length,
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
        <p className="kicker">{t.opportunities.kicker}</p>
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

        {/* What the Rep is doing for them, and what is ready to read. */}
        {(preparingItems.length > 0 || Object.keys(ready).length > 0) && (
          <ul className={styles.progress} aria-live="polite">
            {preparingItems.map((item) => (
              <li key={item.key} className={styles.progressItem}>
                <span className={styles.progressPulse} aria-hidden="true" />
                {t.opportunities.apply.preparingFor}
                <span className={styles.progressTitle}>{item.company}</span>
              </li>
            ))}
            {Object.entries(ready).map(([key, title]) => (
              <li key={key} className={`${styles.progressItem} ${styles.progressReady}`}>
                <span className={styles.progressCheck} aria-hidden="true">
                  ✓
                </span>
                {t.opportunities.apply.readyFor}
                <span className={styles.progressTitle}>{title}</span>
                <button
                  type="button"
                  className={styles.progressSee}
                  onClick={() => {
                    choose('wanted')
                    setFocus(key)
                    setReady((current) => {
                      const next = { ...current }
                      delete next[key]
                      return next
                    })
                  }}
                >
                  {t.opportunities.apply.see}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div ref={panelRef} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={styles.panel} key={tab}>
          {/* After the first few answers, the rest can come on WhatsApp: asked
              once, where the next offer would be, so it is seen. */}
          {tab === 'new' && handoff && (
            <div className={styles.handoff}>
              <WhatsAppConnect linked={false} />
              <button type="button" className={`text-btn ${styles.handoffStay}`} onClick={stayHere}>
                {t.opportunities.handoffStay}
              </button>
            </div>
          )}
          {tab === 'new' &&
            !handoff &&
            (newDeck.length === 0 ? (
              <div className={styles.empty}>
                <Symbol size={96} watch breathe={!paused} label={paused ? t.listening.pause.status : t.listening.label} />
                <p className={styles.emptyLine}>{paused ? t.listening.pause.title : view.withheld > 0 ? t.opportunities.emptyMore : t.opportunities.empty}</p>
                <p className={styles.emptyLead}>{paused ? t.listening.pause.line : view.withheld > 0 ? t.opportunities.emptyMoreLead : t.opportunities.emptyLead}</p>
                {!paused && view.drought && <DroughtNote drought={view.drought} t={t.drought} />}
              </div>
            ) : (
              <Deck
                items={newDeck}
                itemKey={(item) => item.id}
                label={t.opportunities.tabs.new}
                render={(item) => (
                  <FoundCard
                    item={item}
                    onAnswered={(response) => {
                      setNotice({ text: response === 'interested' ? t.opportunities.movedToWanted : response === 'already_applied' ? t.opportunities.movedToSent : t.opportunities.savedNotForMe, key: '' })
                      void reload().then(toPanel)
                    }}
                  />
                )}
              />
            ))}

          {tab === 'wanted' &&
            (view.wanted.length === 0 ? (
              <p className={styles.panelEmpty}>{t.opportunities.wanted.empty}</p>
            ) : (
              <Deck
                items={view.wanted}
                itemKey={(item) => item.key}
                label={t.opportunities.tabs.wanted}
                focus={focus}
                busy={(item) => Boolean(preparing[item.opportunityIds[0]])}
                render={(item) => (
                  <WantedCard
                    item={item}
                    arrived={false}
                    inDeck
                    onChanged={() => void reload()}
                    application={{
                      prepared: drafts[item.opportunityIds[0]] ?? item.prepared,
                      preparing: Boolean(preparing[item.opportunityIds[0]]),
                      error: prepareErrors[item.opportunityIds[0]] || null,
                      onPrepare: () => void prepare(item),
                      applicant: view.applicant,
                    }}
                  />
                )}
              />
            ))}

          {tab === 'sent' && view.whatsapp.available && <WhatsAppConnect linked={view.whatsapp.linked} />}
          {tab === 'sent' &&
            (view.sent.length === 0 ? (
              <p className={styles.panelEmpty}>{t.opportunities.wanted.sentEmpty}</p>
            ) : (
              <>
                <p className={styles.wantedLead}>{t.opportunities.wanted.sentLead}</p>
                {view.sent.map((item) => (
                  <WantedCard key={item.key} item={item} arrived={false} onChanged={() => void reload()} application={null} />
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
              {view.discarded.length === 0 ? (
                view.dropped.length === 0 && <p className={styles.panelEmpty}>{t.opportunities.asideEmpty}</p>
              ) : (
                <>
                  {view.dropped.length > 0 && <h2 className={styles.sectionTitle}>{t.opportunities.bySetAside}</h2>}
                  <p className={styles.discardedLead}>{t.opportunities.discardedLead}</p>
                  <ul className={styles.discardedList}>
                    {view.discarded.slice(0, asideShown).map((item) => (
                      <DiscardedItem
                        key={item.id}
                        item={item}
                        onWanted={() => {
                          setNotice({ text: t.opportunities.movedToWanted, key: '' })
                          void reload()
                        }}
                      />
                    ))}
                  </ul>
                  {view.discarded.length > asideShown && (
                    <button type="button" className={`text-btn ${styles.asideMore}`} onClick={() => setAsideShown((shown) => shown + ASIDE_PAGE)}>
                      {t.opportunities.asideMore(Math.min(ASIDE_PAGE, view.discarded.length - asideShown))}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <Link href="/listening" className="text-btn">
            {paused ? t.listening.pause.back : t.triage.backToListening}
          </Link>
        </div>
      </main>

      {notice && (
        <Notice
          key={notice.text}
          text={notice.text}
          action={
            notice.key
              ? {
                  label: t.opportunities.apply.see,
                  run: () => {
                    choose('wanted')
                    setFocus(notice.key)
                  },
                }
              : null
          }
          onDone={() => setNotice(null)}
        />
      )}
    </>
  )
}

// A quiet note at the foot of the screen that leaves on its own.
// It is shown for its own time: the page redrawing behind it (an answer
// reloading the offers) does not start the count again.
function Notice({ text, action, onDone }: { text: string; action: { label: string; run: () => void } | null; onDone: () => void }) {
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  const withAction = action !== null
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), withAction ? 7000 : 3500)
    return () => window.clearTimeout(id)
  }, [withAction])
  return (
    <div className={styles.notice} role="status">
      <span>{text}</span>
      {action && (
        <button
          type="button"
          className={styles.noticeAction}
          onClick={() => {
            action.run()
            onDone()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// The pay: as the offer publishes it, or, when it publishes none, what a
// public guide says such a role pays, always marked as an estimate with its
// source, and whether it falls short of their minimum.
function Pay({ salary, estimate }: { salary: string | null; estimate: ShownEstimate | null }) {
  const t = useT()
  if (salary) return <p className={styles.salary}>{salary}</p>
  if (!estimate) return null
  const words = t.salaryEstimate
  return (
    <div className={styles.estimate}>
      <p className={styles.estimateFigure}>
        <span className={styles.estimateLabel}>{words.label}:</span> {estimateRange(estimate)}
      </p>
      <p className={styles.estimateSource}>
        <a href={estimate.url} target="_blank" rel="noreferrer" aria-label={`${words.source}: ${estimateSource(estimate, words)}`}>
          {estimateSource(estimate, words)}
        </a>
      </p>
      {estimate.belowFloor !== null && (
        <p className={styles.estimateShort}>{words.belowFloor(estimateRange({ min: estimate.belowFloor, max: estimate.belowFloor }))}</p>
      )}
    </div>
  )
}

// On a phone the card is long and its answer at the end: while it is read, the
// same two answers wait in a bar at the foot of the screen, until the ones in
// the card come into sight or it is answered.
const PHONE = '(max-width: 640px)'
// The bar's height: the card's own answers count as in sight once above it.
const BAR_PX = 88

function useDecisionBar(active: boolean) {
  const cardRef = useRef<HTMLElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [phone, setPhone] = useState(false)
  const [cardInView, setCardInView] = useState(false)
  const [actionsInView, setActionsInView] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(PHONE)
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const card = cardRef.current
    const actions = actionsRef.current
    if (!active || !phone || !card || typeof IntersectionObserver === 'undefined') return
    const onCard = new IntersectionObserver(([entry]) => setCardInView(entry.isIntersecting))
    const onActions = new IntersectionObserver(([entry]) => setActionsInView(entry.isIntersecting), { rootMargin: `0px 0px -${BAR_PX}px 0px` })
    onCard.observe(card)
    if (actions) onActions.observe(actions)
    return () => {
      onCard.disconnect()
      onActions.disconnect()
      setCardInView(false)
      setActionsInView(false)
    }
  }, [active, phone])

  const shown = active && phone && cardInView && !actionsInView
  // The corner button moves up out of its way; the page leaves room at the foot.
  useEffect(() => {
    if (!shown) return
    document.body.setAttribute('data-decision-bar', '')
    return () => document.body.removeAttribute('data-decision-bar')
  }, [shown])

  return { cardRef, actionsRef, shown }
}

// A role posted in twenty cities names three and says how many more: the
// list is not what decides it.
function fewPlaces(location: string | null, more: (count: number) => string): string | null {
  if (!location) return null
  const places = location.split(' · ')
  return places.length <= 3 ? location : `${places.slice(0, 3).join(' · ')} ${more(places.length - 3)}`
}

// Words for having sent it already: "ya apliqué", "ya la he enviado", "already applied".
const SOUNDS_APPLIED = /\bya\b.{0,25}\b(apliqu|aplicad|envi[eé]|enviad|me (he )?inscrib|postul)|\balready\b.{0,15}\b(applied|sent|apply)/i

function FoundCard({ item, onAnswered }: { item: FoundOpportunity; onAnswered: (response: Response) => void }) {
  const [leaving, setLeaving] = useState(false)
  const t = useT()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const meta = [item.company, fewPlaces(item.location, t.opportunities.morePlaces), item.workplace].filter(Boolean).join(' · ')
  const { cardRef, actionsRef, shown: barShown } = useDecisionBar(item.response === null && !asking && !leaving)

  async function answer(response: Response, withReason?: string) {
    setError(null)
    if (await respond(item.id, response, withReason)) {
      setAsking(false)
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setLeaving(true)
        await wait(SLIDE_MS)
      }
      onAnswered(response)
    } else {
      setError(t.opportunities.responseFailed)
    }
  }

  return (
    <article ref={cardRef} className={leaving ? `${styles.card} ${styles.slidingOut}` : styles.card} data-answered={item.response !== null}>
      <p className={styles.cardKicker}>
        <Symbol size={20} /> {item.estimate?.belowFloor ? t.opportunities.worthHearingShort : t.opportunities.worthHearing}
      </p>
      <h2 className={styles.cardTitle}>{item.title}</h2>
      <p className={styles.meta}>{meta}</p>
      {item.stale && <p className={styles.staleTag}>{t.opportunities.judgedBefore}</p>}
      <Pay salary={item.salary} estimate={item.estimate} />
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
        <div ref={actionsRef} className={styles.actions}>
          <button type="button" className="btn" onClick={() => void answer('interested')}>
            {t.opportunities.interested}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>
            {t.opportunities.notForMe}
          </button>
          {/* Sent already, on their own: not a no, and not one to send. */}
          <button type="button" className="text-btn" onClick={() => void answer('already_applied')}>
            {t.opportunities.alreadyApplied}
          </button>
        </div>
      )}

      {/* On the page itself: the deck's card moves as it comes in, and a
          fixed bar inside it would move with it instead of staying at the foot. */}
      {barShown &&
        createPortal(
          <div className={styles.decisionBar} role="group" aria-label={t.opportunities.decisionBar(item.title)}>
            <button type="button" className="btn" onClick={() => void answer('interested')}>
              {t.opportunities.interested}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>
              {t.opportunities.notForMe}
            </button>
          </div>,
          document.body,
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
          {/* "Ya la he enviado por otro lado" is not a reason to learn a no from. */}
          {SOUNDS_APPLIED.test(reason) && (
            <button type="button" className="text-btn" onClick={() => void answer('already_applied')}>
              {t.opportunities.soundsApplied}
            </button>
          )}
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
// In a deck the card slides out to the side instead: closing its height would
// shift the page under the next one.
const SLIDE_MS = 420

interface CardApplication {
  prepared: PreparedApplication | null
  preparing: boolean
  error: string | null
  onPrepare: () => void
  applicant: OpportunitiesView['applicant']
}

function WantedCard({
  item,
  arrived,
  onChanged,
  application,
  inDeck = false,
}: {
  item: WantedOpportunity
  arrived: boolean
  onChanged: () => void
  application: CardApplication | null
  inDeck?: boolean
}) {
  const leave = inDeck ? SLIDE_MS : FOLD_MS
  const { t, locale } = useI18n()
  const w = t.opportunities.wanted
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What was just done here, so it can be shown before the screen reloads.
  const [moment, setMoment] = useState<'stamped' | 'striking' | 'folding' | null>(null)
  const meta = [item.company, fewPlaces(item.location, t.opportunities.morePlaces), item.workplace].filter(Boolean).join(' · ')
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
      await wait(leave)
    } else if (progress === 'dropped' && !calm()) {
      setMoment('striking')
      await wait(STRIKE_MS)
      setMoment('folding')
      await wait(leave)
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
    <div
      className={
        moment === 'folding' ? `${styles.fold} ${inDeck ? styles.slidingOut : styles.folding}` : inDeck ? styles.deckCard : styles.fold
      }
    >
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
        <Pay salary={item.salary} estimate={item.estimate} />
        {applied && item.outcome && <p className={styles.outcome}>{t.whatsapp.outcome[item.outcome]}</p>}
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

        {application && item.progress !== 'applied' && !item.closed && (
          <ApplicationPanel
            {...application}
            opportunityId={item.opportunityIds[0]}
            company={item.company}
            url={item.url}
            onSent={() => void mark('applied')}
          />
        )}
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
      {item.stale && <p className={styles.staleTag}>{t.opportunities.judgedBefore}</p>}
      {item.reasons.map((reason, index) => (
        <p key={index} className={styles.discardReason}>
          {reason.kind === 'wrong_role'
            ? t.opportunities.wrongRole(reason.text)
            : reason.kind === 'below_level'
              ? t.opportunities.belowLevel(reason.text)
              : reason.kind === 'above_level'
              ? t.opportunities.aboveLevel(reason.text)
              : reason.kind === 'salary_estimate'
              ? t.opportunities.salaryEstimate(estimateRange(reason.estimate))
              : reason.kind === 'office_abroad'
              ? t.opportunities.officeAbroad
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
              : reason.kind === 'office_elsewhere'
              ? t.opportunities.officeElsewhere
              : reason.kind === 'unread'
              ? t.opportunities.unread
              : reason.kind === 'unverified'
              ? t.opportunities.unverified(reason.rule, reason.note)
              : t.opportunities.notEnoughReasons}
          {(reason.kind === 'filter' || reason.kind === 'salary_floor' || reason.kind === 'language') && reason.quote && (
            <span className={styles.discardQuote}> — “{reason.quote}”</span>
          )}
          {(reason.kind === 'remote_unconfirmed' || reason.kind === 'remote_elsewhere' || reason.kind === 'remote_countries' || reason.kind === 'office_elsewhere' || reason.kind === 'office_abroad') && reason.places && (
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
