'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import Header from '@/components/Header'
import { useI18n } from '@/components/I18nProvider'
import { postJson, requestJson } from '@/components/api'
import AdminFeedbackList from '@/components/flows/AdminFeedbackList'
import AdminHealth from '@/components/flows/AdminHealth'
import type { AdminFeedbackItem, FeedbackKind } from '@/lib/admin/feedback-triage'
import type { AdminWaitlistEntry, BetaSeats, InviteOutcome } from '@/lib/admin/invites'
import type { AdminOverview, AdminWaitlistState } from '@/lib/admin/overview'
import { adminDictionaries } from '@/lib/i18n/dictionaries/admin'
import styles from '@/app/admin/admin.module.css'

type Tab = 'waitlist' | 'feedback' | 'health'
type WaitlistFilter = 'all' | 'waiting' | 'invited' | 'joined'
type FeedbackFilter = 'all' | 'unread' | FeedbackKind

const FEEDBACK_FILTERS: FeedbackFilter[] = ['all', 'unread', 'blocking_bug', 'bug', 'confusing', 'request', 'praise', 'other']

// Who can still be let in: not in yet and without an accepted invitation.
function invitable(entry: AdminWaitlistEntry): boolean {
  return entry.status === 'waiting' || entry.status === 'link' || entry.status === 'invited'
}

function matchesFilter(entry: AdminWaitlistEntry, filter: WaitlistFilter): boolean {
  if (filter === 'waiting') return entry.status === 'waiting' || entry.status === 'link'
  if (filter === 'invited') return entry.status === 'invited'
  if (filter === 'joined') return entry.status === 'joined' || entry.status === 'accepted'
  return true
}

export default function AdminFlow({ initial, initialTab }: { initial: AdminOverview; initialTab: Tab }) {
  const { locale } = useI18n()
  const a = adminDictionaries[locale]
  const [tab, setTab] = useState<Tab>(initialTab)
  const [waitlist, setWaitlist] = useState<AdminWaitlistState>(initial.waitlist)
  const [seats, setSeats] = useState<BetaSeats>(initial.seats)
  const [feedback, setFeedback] = useState<AdminFeedbackItem[]>(initial.feedback)
  const [untriaged, setUntriaged] = useState(initial.untriaged)

  const invitedCount = waitlist.entries.filter((entry) => entry.status === 'invited').length
  const unread = feedback.filter((item) => !item.seen_at).length

  function showTab(next: Tab) {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'waitlist') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url)
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>{a.title}</h1>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{waitlist.connection === 'ok' ? waitlist.entries.length : '—'}</span>
            <span className={styles.statLabel}>{a.stats.waitlist}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{waitlist.connection === 'ok' ? invitedCount : '—'}</span>
            <span className={styles.statLabel}>{a.stats.invited}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{seats.accounts}</span>
            <span className={styles.statLabel}>{a.stats.joined}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {seats.capacity === null || seats.remaining === null ? a.stats.noLimit : a.stats.seatsOf(seats.remaining, seats.capacity)}
            </span>
            <span className={styles.statLabel}>{a.stats.seats}</span>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label={a.title}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'waitlist'}
            className={tab === 'waitlist' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => showTab('waitlist')}
          >
            {a.tabs.waitlist}
            {waitlist.connection === 'ok' && <span className={styles.tabCount}>{waitlist.entries.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'feedback'}
            className={tab === 'feedback' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => showTab('feedback')}
          >
            {a.tabs.feedback}
            <span className={styles.tabCount}>{unread > 0 ? `${unread} / ${feedback.length}` : feedback.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'health'}
            className={tab === 'health' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => showTab('health')}
          >
            {a.tabs.health}
          </button>
        </div>

        {tab === 'waitlist' ? (
          <WaitlistTab
            waitlist={waitlist}
            seats={seats}
            onUpdate={(next, nextSeats) => {
              setWaitlist(next)
              setSeats(nextSeats)
            }}
          />
        ) : tab === 'health' ? (
          <AdminHealth />
        ) : (
          <FeedbackTab
            items={feedback}
            untriaged={untriaged}
            triageAvailable={initial.triageAvailable}
            onItems={setFeedback}
            onUntriaged={setUntriaged}
          />
        )}
      </main>
    </>
  )
}

function WaitlistTab({
  waitlist,
  seats,
  onUpdate,
}: {
  waitlist: AdminWaitlistState
  seats: BetaSeats
  onUpdate: (waitlist: AdminWaitlistState, seats: BetaSeats) => void
}) {
  const { locale } = useI18n()
  const w = adminDictionaries[locale].waitlist
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WaitlistFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return waitlist.entries.filter((entry) => matchesFilter(entry, filter) && (!needle || entry.email.toLowerCase().includes(needle)))
  }, [waitlist.entries, query, filter])
  const visibleInvitable = visible.filter(invitable)
  const allPicked = visibleInvitable.length > 0 && visibleInvitable.every((entry) => selected.has(entry.email))

  function toggle(email: string) {
    setConfirming(false)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  function toggleAll() {
    setConfirming(false)
    setSelected((current) => {
      const next = new Set(current)
      for (const entry of visibleInvitable) {
        if (allPicked) next.delete(entry.email)
        else next.add(entry.email)
      }
      return next
    })
  }

  function refusal(error: string | undefined, remaining: number | null | undefined, max?: number): string {
    if (error === 'full') return w.refused.full
    if (error === 'not_enough_seats') return w.refused.not_enough_seats(remaining ?? 0)
    if (error === 'too_many') return w.refused.too_many(max ?? 50)
    return w.refused.failed
  }

  async function invite() {
    setBusy(true)
    setMessage(null)
    const { ok, data } = await postJson<{
      outcomes: InviteOutcome[]
      waitlist: AdminWaitlistState
      seats: BetaSeats
      remaining?: number | null
      max?: number
    }>('/api/admin/waitlist', { action: 'invite', emails: [...selected] })
    setBusy(false)
    setConfirming(false)
    if (!ok) {
      if (data.seats) onUpdate(waitlist, data.seats)
      setMessage(refusal(data.error, data.remaining, data.max))
      return
    }
    const count = (result: InviteOutcome['result']) => data.outcomes.filter((outcome) => outcome.result === result).length
    setMessage(w.result(count('sent'), count('already'), count('failed')))
    setSelected(new Set())
    onUpdate(data.waitlist, data.seats)
  }

  async function copyLink(entry: AdminWaitlistEntry) {
    let link = entry.link
    if (!link) {
      const { ok, data } = await postJson<{ outcomes: InviteOutcome[]; waitlist: AdminWaitlistState; seats: BetaSeats; remaining?: number | null }>(
        '/api/admin/waitlist',
        { action: 'link', emails: [entry.email] },
      )
      if (!ok) {
        setMessage(refusal(data.error, data.remaining))
        return
      }
      link = data.outcomes.find((outcome) => outcome.link)?.link ?? null
      onUpdate(data.waitlist, data.seats)
    }
    if (!link) return
    await navigator.clipboard.writeText(link).catch(() => window.prompt(w.copyLink, link ?? ''))
    setCopied(entry.email)
    window.setTimeout(() => setCopied((current) => (current === entry.email ? null : current)), 2000)
  }

  async function retry() {
    setRetrying(true)
    const { ok, data } = await requestJson<{ waitlist: AdminWaitlistState; seats: BetaSeats }>('/api/admin/waitlist')
    setRetrying(false)
    if (ok) onUpdate(data.waitlist, data.seats)
  }

  if (waitlist.connection === 'off') {
    return (
      <>
        <p className={styles.note}>{w.off}</p>
        <p className={styles.hint}>{w.offHint}</p>
      </>
    )
  }
  if (waitlist.connection === 'error') {
    return (
      <>
        <p className={styles.note}>{w.error}</p>
        <button type="button" className="text-btn" onClick={() => void retry()} disabled={retrying}>
          {w.retry}
        </button>
      </>
    )
  }
  if (waitlist.entries.length === 0) return <p className={styles.note}>{w.empty}</p>

  const statusText = (entry: AdminWaitlistEntry) => {
    if (entry.status === 'joined') return w.status.joined
    if (entry.status === 'accepted') return w.status.accepted
    if (entry.status === 'invited' && entry.sent_at) return w.status.invited(date.format(new Date(entry.sent_at)))
    if (entry.status === 'link' && entry.invited_at) return w.status.link(date.format(new Date(entry.invited_at)))
    return w.status.waiting
  }

  return (
    <>
      <div className={styles.tools}>
        <input
          type="search"
          className={styles.search}
          placeholder={w.search}
          aria-label={w.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={styles.chips}>
          {(['all', 'waiting', 'invited', 'joined'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {w.filters[value]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className={styles.note}>{w.noMatch}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.checkCell}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={allPicked}
                  disabled={visibleInvitable.length === 0}
                  onChange={toggleAll}
                  aria-label={w.selectAll}
                  title={w.selectAll}
                />
              </th>
              <th>{w.columns.email}</th>
              <th>{w.columns.date}</th>
              <th>{w.columns.locale}</th>
              <th>{w.columns.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.email} className={selected.has(entry.email) ? styles.picked : undefined}>
                <td className={styles.checkCell}>
                  {invitable(entry) && (
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={selected.has(entry.email)}
                      onChange={() => toggle(entry.email)}
                      aria-label={w.select(entry.email)}
                    />
                  )}
                </td>
                <td>
                  <span className={styles.email}>{entry.email}</span>
                  {entry.audience === 'company' && <span className={styles.tag}>{w.company}</span>}
                </td>
                <td className={styles.muted}>{date.format(new Date(entry.created_at))}</td>
                <td className={styles.muted}>{entry.locale.toUpperCase()}</td>
                <td className={entry.status === 'joined' ? `${styles.status} ${styles.statusJoined}` : styles.status}>
                  {statusText(entry)}
                  {entry.send_error && entry.status !== 'joined' && <span className={styles.error}>{w.sendFailed}</span>}
                </td>
                <td>
                  <div className={styles.actions}>
                    {invitable(entry) && (
                      <button type="button" className={styles.textAction} onClick={() => void copyLink(entry)}>
                        {copied === entry.email ? w.copied : w.copyLink}
                      </button>
                    )}
                    {entry.candidate_id && <Link href={`/admin/people/${encodeURIComponent(entry.candidate_id)}`}>{w.person}</Link>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}

      {selected.size > 0 && (
        <div className={styles.bar}>
          {confirming ? (
            <div className={styles.confirm}>
              <p className={styles.confirmTitle}>{w.confirm(selected.size)}</p>
              <p className={styles.confirmLead}>{w.confirmLead}</p>
              {seats.remaining !== null && seats.capacity !== null && (
                <p className={styles.confirmLead}>
                  {adminDictionaries[locale].stats.seats}: {adminDictionaries[locale].stats.seatsOf(seats.remaining, seats.capacity)}
                </p>
              )}
              <div className={styles.barButtons} style={{ marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => void invite()} disabled={busy}>
                  {busy ? w.sending : w.confirmSend}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)} disabled={busy}>
                  {w.cancel}
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className={styles.barText}>{w.selected(selected.size)}</span>
              <div className={styles.barButtons}>
                <button type="button" className="btn btn-quiet" onClick={() => setSelected(new Set())}>
                  {w.clear}
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={seats.full}>
                  {w.invite}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function FeedbackTab({
  items,
  untriaged,
  triageAvailable,
  onItems,
  onUntriaged,
}: {
  items: AdminFeedbackItem[]
  untriaged: number
  triageAvailable: boolean
  onItems: (items: AdminFeedbackItem[]) => void
  onUntriaged: (n: number) => void
}) {
  const { locale } = useI18n()
  const f = adminDictionaries[locale].feedback
  const [filter, setFilter] = useState<FeedbackFilter>('all')
  const [triaging, setTriaging] = useState(false)
  const started = useRef(false)

  async function triage() {
    setTriaging(true)
    const { ok, data } = await postJson<{ feedback: AdminFeedbackItem[]; untriaged: number }>('/api/admin/feedback', { action: 'triage' })
    setTriaging(false)
    if (ok) {
      onItems(data.feedback)
      onUntriaged(data.untriaged)
    }
  }

  // What arrived since the last visit is sorted on opening the tab, a few at a time.
  useEffect(() => {
    if (started.current || !triageAvailable || untriaged === 0) return
    started.current = true
    void triage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = items.filter((item) => (filter === 'all' ? true : filter === 'unread' ? !item.seen_at : item.kind === filter))
  const present = new Set(items.map((item) => item.kind))

  return (
    <>
      <div className={styles.tools}>
        <div className={styles.chips}>
          {FEEDBACK_FILTERS.filter((value) => value === 'all' || value === 'unread' || present.has(value)).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' || value === 'unread' ? f.filters[value] : f.kinds[value]}
            </button>
          ))}
        </div>
        {triageAvailable && untriaged > 0 && (
          <button type="button" className="text-btn" onClick={() => void triage()} disabled={triaging}>
            {triaging ? f.triaging : f.triage(untriaged)}
          </button>
        )}
      </div>
      {!triageAvailable && <p className={styles.hint}>{f.triageOff}</p>}

      {items.length === 0 ? (
        <p className={styles.note}>{f.empty}</p>
      ) : visible.length === 0 ? (
        <p className={styles.note}>{f.noMatch}</p>
      ) : (
        <AdminFeedbackList
          items={visible}
          onChange={(changed) => onItems(items.map((item) => changed.find((entry) => entry.id === item.id) ?? item))}
        />
      )}
    </>
  )
}
