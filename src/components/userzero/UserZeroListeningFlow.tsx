'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import UserZeroInterruption from '@/components/userzero/UserZeroInterruption'
import styles from '@/app/listening/listening.module.css'
import type { InterruptionView } from '@/lib/opportunity-view'
import type { CandidateResponse } from '@/domains/opportunity/types'

interface ListeningVm {
  evidenceCount: number
  capabilitiesCount: number
  listeningFor: string[]
  hasIntent: boolean
  intentConfirmed: boolean
  criteria: string[]
  notifyChannel: string | null
  notifyEmail: string | null
  notifyWhatsapp: string | null
}

type Phase = 'arriving' | 'home'
type Channel = 'whatsapp' | 'email' | 'both'

const activationMs = 2600

/**
 * How often the screen asks whether anything got through.
 *
 * The reading runs on the queue, so nothing can arrive as the answer to a
 * request: the screen finds out afterwards, the same way it would find out
 * from a message. Slow on purpose — this is a screen someone leaves open.
 */
const interruptionPollMs = 6000

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'both', label: 'Both' },
]

export default function UserZeroListeningFlow({
  vm,
  interruption: initialInterruption,
}: {
  vm: ListeningVm
  interruption: InterruptionView | null
}) {
  // Something is already waiting, so there is nothing to arrive at: skip
  // straight to it. Sitting through "your Rep is listening" when your Rep
  // has already found something is the wrong screen, and it is also the one
  // someone opening a notification would land on.
  const [phase, setPhase] = useState<Phase>(initialInterruption ? 'home' : 'arriving')
  const [interruption, setInterruption] = useState(initialInterruption)
  const [answered, setAnswered] = useState<CandidateResponse | null>(null)
  const [returnState, setReturnState] = useState(false)
  const [channel, setChannel] = useState<Channel | null>((vm.notifyChannel as Channel) ?? null)
  const [email, setEmail] = useState(vm.notifyEmail ?? '')
  const [whatsapp, setWhatsapp] = useState(vm.notifyWhatsapp ?? '')
  const [saved, setSaved] = useState<string | null>(null)

  async function saveReach(next: Partial<{ channel: Channel | null; email: string; whatsapp: string }>) {
    const body = {
      notifyChannel: next.channel !== undefined ? next.channel : channel,
      notifyEmail: next.email !== undefined ? next.email : email,
      notifyWhatsapp: next.whatsapp !== undefined ? next.whatsapp : whatsapp,
    }
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setSaved(response.ok ? 'Saved.' : "That didn't save. Try again.")
    } catch {
      setSaved('No connection right now. It will need saving again.')
    }
  }

  useEffect(() => {
    let activated = false
    try {
      activated = window.sessionStorage.getItem('amble-listening-activated') === '1'
      window.sessionStorage.removeItem('amble-listening-activated')
    } catch {
      activated = false
    }
    const delay = activated ? activationMs : 0
    const id = window.setTimeout(() => setPhase('home'), delay)
    return () => window.clearTimeout(id)
  }, [])

  // Nothing can arrive as the answer to a request — the reading happens on
  // the queue — so the screen asks every so often and goes on saying
  // nothing until there is something to say.
  useEffect(() => {
    if (phase !== 'home' || interruption) return
    const check = async () => {
      try {
        const response = await fetch('/api/opportunities/interruption')
        if (!response.ok) return
        const body = (await response.json()) as { interruption: InterruptionView | null }
        if (body.interruption) {
          setInterruption(body.interruption)
          setAnswered(null)
        }
      } catch {
        // Out of signal. Whatever it is will still be there next tick.
      }
    }
    const id = window.setInterval(() => void check(), interruptionPollMs)
    return () => window.clearInterval(id)
  }, [phase, interruption])

  if (phase === 'arriving') {
    return (
      <>
        <Header />
        <main className={styles.page}>
          <div className={`${styles.center} ${styles.centerFull}`} role="status">
            <StatusDot />
            <p className={styles.arrivingLine}>Your Rep is listening.</p>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        {interruption ? (
          <UserZeroInterruption
            interruption={interruption}
            onAnswered={(response) => {
              setInterruption(null)
              setAnswered(response)
            }}
          />
        ) : answered ? (
          <div className={`${styles.center} ${styles.centerFull}`}>
            <StatusDot label="Listening" />
            <p className={`${styles.statusLine} ${styles.statusLineReturn}`}>
              {answered === 'HEAR_THEM_OUT'
                ? 'Good. I’ve written that down.'
                : 'Fine. That one’s gone.'}
            </p>
            <p className={styles.answeredNote}>
              {answered === 'HEAR_THEM_OUT'
                ? 'Nothing has gone to them. I can’t talk to a company on your behalf yet — when I can, this is where it starts.'
                : 'I haven’t changed what I’m listening for. A no is about that job, not about the shape of what you want.'}
            </p>
            <p className={styles.arrivingLine}>I&rsquo;m still listening.</p>
          </div>
        ) : returnState ? (
          <div className={`${styles.center} ${styles.centerFull}`}>
            <StatusDot label="Listening" />
            <p className={`${styles.statusLine} ${styles.statusLineReturn}`}>
              Nothing worth bothering you with.
            </p>
            <p className={styles.arrivingLine}>I&rsquo;m still listening.</p>
          </div>
        ) : (
          <div className={styles.center}>
            <StatusDot label="Listening" />
            <p className={styles.statusLine}>
              I&rsquo;ll only interrupt you when something deserves your attention.
            </p>
            <div className={styles.listeningFor}>
              <p className="kicker">Currently listening for</p>
              {vm.listeningFor.length > 0 ? (
                <div className={styles.listeningForValues}>
                  {vm.listeningFor.map((item) => (
                    <span key={item} className={styles.listeningForValue}>
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.listeningForValue}>
                  {vm.hasIntent
                    ? 'Confirm what your Rep should listen for.'
                    : 'You haven\u2019t told your Rep what to listen for yet.'}
                </p>
              )}
              <div className={styles.changeIntent}>
                <Link href="/me/intent" className="text-btn">
                  Change what I&rsquo;m listening for
                </Link>
              </div>
            </div>
          </div>
        )}

        {!returnState && !interruption && !answered && (
          <>
            <section className={styles.deal} aria-label="What happens from here">
              <p className="kicker">From here</p>
              <p className={styles.dealLead}>
                Offers have started arriving — I&rsquo;m reading Manfred&rsquo;s board for now.
                Almost none of them will reach you. That is the deal.
              </p>
              <ul className={styles.dealList}>
                <li className={styles.dealItem}>
                  I hold it against what you left me with. If it doesn&rsquo;t clear that, you never
                  hear about it — no digest, no &ldquo;you might also like&rdquo;.
                </li>
                <li className={styles.dealItem}>
                  If it does clear it, you get one message: what the role is, what it pays, and the
                  specific thing about you that made me think it was worth your time.
                </li>
                <li className={styles.dealItem}>
                  Your Map stays here. Nobody sees it, and nothing is sent anywhere, until you say
                  so.
                </li>
              </ul>
              {vm.criteria.length > 0 && (
                <>
                  <div className={styles.criteria}>
                    {vm.criteria.map((criterion) => (
                      <span key={criterion} className={styles.criterion}>
                        {criterion}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className={styles.reach} aria-label="How to reach you">
              <p className="kicker">When it happens</p>
              <p className={styles.dealLead}>Where should I reach you?</p>
              <div className={styles.reachChips}>
                {CHANNELS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.reachChip} ${channel === option.value ? styles.reachChipOn : ''}`}
                    aria-pressed={channel === option.value}
                    onClick={() => {
                      const next = channel === option.value ? null : option.value
                      setChannel(next)
                      setSaved(null)
                      void saveReach({ channel: next })
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {(channel === 'email' || channel === 'both') && (
                <div className={styles.reachFields}>
                  <input
                    type="email"
                    className={styles.reachInput}
                    placeholder="you@example.com"
                    aria-label="Email address"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      setSaved(null)
                    }}
                    onBlur={() => void saveReach({})}
                  />
                </div>
              )}

              {(channel === 'whatsapp' || channel === 'both') && (
                <div className={styles.reachFields}>
                  <input
                    type="tel"
                    className={styles.reachInput}
                    placeholder="+34 600 000 000"
                    aria-label="WhatsApp number"
                    value={whatsapp}
                    onChange={(event) => {
                      setWhatsapp(event.target.value)
                      setSaved(null)
                    }}
                    onBlur={() => void saveReach({})}
                  />
                </div>
              )}

              <p className={styles.reachStatus} role="status">
                {saved ?? (channel === null ? 'Pick one and I will remember it.' : '')}
              </p>
            </section>
          </>
        )}

        <div className={styles.repSummary}>
          <p className={styles.repLabel}>Your Rep</p>
          <p className={styles.repCount}>{vm.evidenceCount} pieces of evidence</p>
          <p className={styles.repCount}>{vm.capabilitiesCount} capabilities</p>
          <Link href="/me" className={`text-btn ${styles.repLink}`}>
            View your Professional Map →
          </Link>
        </div>

        {!interruption && !answered && (
          <div className={styles.fixtureToggle}>
            <button
              type="button"
              className={`text-btn ${styles.fixtureToggleBtn}`}
              onClick={() => setReturnState((value) => !value)}
            >
              {returnState ? 'View listening state' : 'View return state'}
            </button>
          </div>
        )}
      </main>
    </>
  )
}
