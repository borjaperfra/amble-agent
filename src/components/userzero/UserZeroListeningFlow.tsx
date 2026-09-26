'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import StatusDot from '@/components/StatusDot'
import styles from '@/app/listening/listening.module.css'

interface ListeningVm {
  evidenceCount: number
  capabilitiesCount: number
  listeningFor: string[]
  hasIntent: boolean
  intentConfirmed: boolean
}

type Phase = 'arriving' | 'home'

const activationMs = 2600

export default function UserZeroListeningFlow({ vm }: { vm: ListeningVm }) {
  const [phase, setPhase] = useState<Phase>('arriving')
  const [returnState, setReturnState] = useState(false)

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

  if (phase === 'arriving') {
    return (
      <>
        <Header />
        <main className={styles.page}>
          <div className={styles.center} role="status">
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
        {returnState ? (
          <div className={styles.center}>
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
                <Link href="/me/triage" className="text-btn">
                  Test what you&rsquo;d actually trade →
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className={styles.repSummary}>
          <p className={styles.repLabel}>Your Rep</p>
          <p className={styles.repCount}>{vm.evidenceCount} pieces of evidence</p>
          <p className={styles.repCount}>{vm.capabilitiesCount} capabilities</p>
          <Link href="/me" className={`text-btn ${styles.repLink}`}>
            View your Professional Map →
          </Link>
        </div>

        <div className={styles.fixtureToggle}>
          <button
            type="button"
            className={`text-btn ${styles.fixtureToggleBtn}`}
            onClick={() => setReturnState((value) => !value)}
          >
            {returnState ? 'View listening state' : 'View return state'}
          </button>
        </div>
      </main>
    </>
  )
}
