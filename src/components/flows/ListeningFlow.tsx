'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import EnvelopePile from '@/components/EnvelopePile'
import type { PileEnvelope } from '@/lib/view'
import Tumbleweed from '@/components/Tumbleweed'
import WhatsAppConnect from '@/components/flows/WhatsAppConnect'
import { useSearchPause } from '@/components/flows/useSearchPause'
import { useT } from '@/components/I18nProvider'
import type { Dictionary } from '@/lib/i18n/dictionaries'
import type { DiscardReason, WeekEntry, WeekLedger } from '@/lib/matching/view'
import styles from '@/app/listening/listening.module.css'

interface ListeningItem {
  id: string
  label: string
}

interface ListeningVm {
  evidenceCount: number
  capabilitiesCount: number
  listeningFor: string[]
  hasIntent: boolean
  intentConfirmed: boolean
  revealed: {
    rules: { wontConsider: ListeningItem[]; weighs: ListeningItem[]; money: ListeningItem[] }
    notFilteringOn: ListeningItem[]
    staleCount: number
  }
  pendingReview: number
  unseenOpportunities: number
  pile: PileEnvelope[]
  week: WeekLedger
  // Their first read is running: what it finds appears as it comes.
  firstReading: boolean
  // Reading again with rules they just changed.
  rereading: boolean
  // They paused the search until further notice.
  paused: boolean
  whatsapp: { available: boolean; linked: boolean }
}

const activationMs = 2600
// The plain headline is said the first time; later visits take turns.
const SEEN_KEY = 'amble-listening-seen'
// A tumbleweed crosses the horizon now and then while nothing comes in.
const FIRST_ROLL_MS = 6000
const FIRST_READ_REFRESH_MS = 15_000
// About how long one crossing takes, so the next never starts before it ends.
const ROLL_MS = 9000
const ROLL_EVERY_MS = [40_000, 90_000] as const

const FLOOR = /salario m[ií]nimo|minimum salary|suelo|floor/i
const isFloor = (label: string) => FLOOR.test(label)

function pickHeadline(count: number): number {
  try {
    const seen = window.localStorage.getItem(SEEN_KEY) === '1'
    window.localStorage.setItem(SEEN_KEY, '1')
    if (!seen) return 0
  } catch {
    return 0
  }
  return Math.floor(Math.random() * count)
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>{title}</p>
      <ul className={styles.groupItems} role="list">
        {children}
      </ul>
    </div>
  )
}

// Marks tell apart what was learned from what was said: only needed when both are listed.
function Condition({ label, marked }: { label: string; marked: boolean }) {
  return (
    <li className={styles.condition}>
      {marked && <span className={styles.mark} aria-hidden="true" />}
      {label}
    </li>
  )
}

// Why something was set aside, in the fewest words that are still true.
function asideReason(reason: DiscardReason | null, t: Dictionary['listening']): string {
  if (!reason) return t.weekReasons.noReason
  switch (reason.kind) {
    case 'filter':
      return reason.rule
    case 'wrong_role':
      return t.weekReasons.wrongRole
    case 'below_level':
      return t.weekReasons.belowLevel
    case 'salary_floor':
      return t.weekReasons.salaryFloor
    case 'language':
      return t.weekReasons.language
    case 'remote_unconfirmed':
      return t.weekReasons.remoteUnconfirmed
    case 'remote_elsewhere':
      return t.weekReasons.remoteElsewhere
    case 'remote_countries':
      return t.weekReasons.remoteCountries
    default:
      return t.weekReasons.noReason
  }
}

function WeekRow({ entry, t }: { entry: WeekEntry; t: Dictionary['listening'] }) {
  const body = (
    <>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{entry.title}</span>
        <span className={styles.rowCompany}>{entry.company}</span>
      </span>
      {entry.status === 'found' ? (
        <span className={styles.rowPassed} aria-hidden="true">
          ✓
        </span>
      ) : (
        <span className={styles.rowReason}>
          {entry.status === 'maybe' ? t.weekMaybe : `× ${asideReason(entry.reason, t)}`}
        </span>
      )}
    </>
  )
  const className = `${styles.row} ${entry.status === 'found' ? styles.rowFound : entry.status === 'aside' ? styles.rowAside : styles.rowMaybe}`
  return (
    <li>
      {entry.status === 'found' ? (
        <Link href="/opportunities" className={className}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}

// The listening home (DESIGN_SYSTEM §23, and the listening moment of
// amble-web): the one moment of colour, with the eye awake and, most of the
// time, nothing to say. Below it, on paper, what the Rep read this week and
// why each one was kept or set aside.
export default function ListeningFlow({ vm }: { vm: ListeningVm }) {
  const t = useT()
  const [arriving, setArriving] = useState(true)
  const [headline, setHeadline] = useState(0)
  const [rolls, setRolls] = useState(0)
  const router = useRouter()
  const searchParams = useSearchParams()
  const forcedPile = process.env.NODE_ENV !== 'production' && searchParams.has('envelopes')
  const { wontConsider, weighs } = vm.revealed.rules
  // The minimum salary leads what is said about money: it is the one that decides.
  const money = [...vm.revealed.rules.money].sort((a, b) => Number(isFloor(b.label)) - Number(isFloor(a.label)))
  const learned = wontConsider.length + weighs.length + money.length
  // Learned and declared side by side: only then do learned ones need a mark.
  const mixed = learned > 0 && vm.listeningFor.length > 0
  const found = vm.unseenOpportunities > 0
  // Something new has come in: then the horizon holds the offers in their
  // hands (new, wanted and sent), not a tumbleweed. With nothing new, the ones
  // they already know about stay in their tabs and the tumbleweed rolls. In
  // development, ?envelopes brings the pile out whatever there is.
  const holding = (vm.pile.some((item) => item.kind === 'new') || forcedPile) && vm.pile.length > 0
  const quietLines = t.listening.quiet
  const { paused, switching, note, toggle: toggleSearch } = useSearchPause(vm.paused)
  const reading = vm.firstReading || vm.rereading

  useEffect(() => {
    let activated = false
    try {
      activated = window.sessionStorage.getItem('amble-listening-activated') === '1'
      window.sessionStorage.removeItem('amble-listening-activated')
    } catch {
      activated = false
    }
    // Activating listening is a moment of its own; any other visit simply opens.
    const id = window.setTimeout(
      () => {
        setHeadline(pickHeadline(quietLines.length))
        setArriving(false)
      },
      activated ? activationMs : 0,
    )
    return () => window.clearTimeout(id)
  }, [quietLines.length])

  // While the first read (or a re-read) runs, the page looks again now and then.
  useEffect(() => {
    if (!reading) return
    const id = window.setInterval(() => router.refresh(), FIRST_READ_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [reading, router])

  // Now and then, while nothing new has come in, a tumbleweed rolls across.
  // In development, ?tumbleweed brings it out whatever there is, to play with.
  useEffect(() => {
    const forced = process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).has('tumbleweed')
    if (arriving || paused || (holding && !forced) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let id = 0
    const next = (ms: number) => {
      id = window.setTimeout(() => {
        setRolls((count) => count + 1)
        const [min, max] = ROLL_EVERY_MS
        next(ROLL_MS + min + Math.random() * (max - min))
      }, ms)
    }
    next(FIRST_ROLL_MS)
    return () => window.clearTimeout(id)
  }, [arriving, holding, paused])

  return (
    <>
      <Header />
      <main className={styles.page}>
        <section className={styles.moment} aria-labelledby="listening-title">
          <Symbol size={148} wake watch breathe={!paused} label={paused ? t.listening.pause.status : t.listening.label} className={styles.eye} />

          {arriving ? (
            <p className={styles.arriving} role="status">
              {paused ? t.listening.pause.title : t.listening.arriving}
            </p>
          ) : (
            <div className={styles.say}>
              <p className={styles.status}>
                <span className={paused ? styles.still : styles.pulse} aria-hidden="true" />
                {paused ? t.listening.pause.status : t.listening.listeningOffers}
              </p>
              <h1 className={styles.title} id="listening-title">
                {paused ? t.listening.pause.title : found ? t.opportunities.foundTitle : vm.firstReading ? t.listening.firstReadingTitle : quietLines[headline]}
              </h1>
              <p className={styles.line} role="status">
                {note === 'failed'
                  ? t.listening.pause.failed
                  : paused
                    ? t.listening.pause.line
                    : note === 'resumed'
                      ? t.listening.pause.resumed
                      : found
                        ? t.opportunities.foundLead
                        : vm.firstReading
                          ? t.listening.firstReading
                          : vm.rereading
                            ? t.listening.rereading
                            : t.listening.stillListening}
              </p>
              {paused ? (
                <button type="button" className={`btn ${styles.seeIt}`} onClick={toggleSearch} disabled={switching}>
                  {t.listening.pause.resume}
                </button>
              ) : (
                found && (
                  <Link href="/opportunities" className={`btn ${styles.seeIt}`}>
                    {t.opportunities.seeIt}
                  </Link>
                )
              )}
              {!paused && (
                <button type="button" className={styles.pauseToggle} onClick={toggleSearch} disabled={switching}>
                  {t.listening.pause.pause}
                </button>
              )}

              {/* The horizon: the offers in their hands, or now and then something rolling by. */}
              <div className={styles.horizon} aria-hidden={holding ? undefined : true}>
                {holding && <EnvelopePile items={vm.pile} />}
                {rolls > 0 && <Tumbleweed key={rolls} />}
              </div>

              {vm.whatsapp.available && !vm.whatsapp.linked && (
                <div className={styles.whatsapp}>
                  <WhatsAppConnect linked={false} />
                </div>
              )}

              <div className={styles.for}>
                <h2 className={styles.forTitle}>{t.listening.attentiveTo}</h2>
                {learned > 0 && <p className={styles.learnedNote}>{mixed ? t.listening.learnedMarked : t.listening.learnedNote}</p>}
                {vm.listeningFor.length + learned > 0 ? (
                  <div className={styles.groups}>
                    {wontConsider.length > 0 && (
                      <Group title={t.listening.groups.must}>
                        {wontConsider.map((item) => (
                          <Condition key={item.id} label={item.label} marked={mixed} />
                        ))}
                      </Group>
                    )}
                    {money.length > 0 && (
                      <Group title={t.listening.groups.money}>
                        {money.map((item) => (
                          <Condition key={item.id} label={item.label} marked={mixed} />
                        ))}
                      </Group>
                    )}
                    {weighs.length > 0 && (
                      <Group title={t.listening.groups.weighs}>
                        {weighs.map((item) => (
                          <Condition key={item.id} label={item.label} marked={mixed} />
                        ))}
                      </Group>
                    )}
                    {vm.listeningFor.length > 0 && (
                      <Group title={t.listening.groups.declared}>
                        {vm.listeningFor.map((item) => (
                          <Condition key={item} label={item} marked={false} />
                        ))}
                      </Group>
                    )}
                  </div>
                ) : (
                  <p className={styles.nothing}>{vm.hasIntent ? t.listening.confirmIntent : t.listening.nothingYet}</p>
                )}

                {vm.revealed.notFilteringOn.length > 0 && (
                  <div className={styles.notFiltering}>
                    <p className={styles.groupTitle}>{t.listening.groups.notFiltering}</p>
                    <p className={styles.notFilteringItems}>
                      {vm.revealed.notFilteringOn.map((item) => item.label).join(' · ')}
                    </p>
                  </div>
                )}

                <Link href="/me/triage" className={styles.change}>
                  {vm.pendingReview > 0 ? t.listening.toReview(vm.pendingReview) : t.listening.changePreferences}
                </Link>
              </div>
            </div>
          )}
        </section>

        {!arriving && (
          <>
            <section className={styles.week} aria-labelledby="week-title">
              <p className="kicker" id="week-title">
                {t.listening.weekKicker}
              </p>
              {vm.week.read > 0 ? (
                <>
                  <p className={styles.tally}>
                    <span className={styles.tallyNumber}>{vm.week.read}</span>
                    <span className={styles.tallyText}>{t.listening.weekRead(vm.week.read, vm.week.worth)}</span>
                  </p>
                  <ul className={styles.rows} role="list">
                    {vm.week.entries.map((entry) => (
                      <WeekRow key={entry.id} entry={entry} t={t.listening} />
                    ))}
                  </ul>
                  <Link href="/opportunities" className={`text-btn ${styles.seeAll}`}>
                    {t.listening.seeAll}
                  </Link>
                </>
              ) : (
                <p className={styles.weekEmpty}>{paused ? t.listening.pause.line : vm.firstReading ? t.listening.weekFirstReading : t.listening.weekEmpty}</p>
              )}
            </section>

            <p className={styles.rep}>
              <span className={styles.repLabel}>{t.common.yourRep}</span>
              <span>{t.listening.evidence(vm.evidenceCount)}</span>
              <span aria-hidden="true">·</span>
              <span>{t.listening.capabilities(vm.capabilitiesCount)}</span>
              <Link href="/me" className={styles.repLink}>
                {t.listening.viewMap}
              </Link>
            </p>
          </>
        )}
      </main>
    </>
  )
}
