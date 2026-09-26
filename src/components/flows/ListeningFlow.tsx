'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import Symbol from '@/components/Symbol'
import { useT } from '@/components/I18nProvider'
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
}

function RevealedGroup({ label, items, muted }: { label: string; items: ListeningItem[]; muted?: boolean }) {
  if (items.length === 0) return null
  return (
    <div className={styles.revealedGroup}>
      <p className={styles.revealedLabel}>{label}</p>
      <div className={styles.listeningForValues}>
        {items.map((item) => (
          <span key={item.id} className={muted ? styles.revealedMuted : styles.listeningForValue}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}

type Phase = 'arriving' | 'home'

const activationMs = 2600

export default function ListeningFlow({ vm }: { vm: ListeningVm }) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('arriving')
  const { wontConsider, weighs, money } = vm.revealed.rules
  const hasRevealed =
    wontConsider.length + weighs.length + money.length + vm.revealed.notFilteringOn.length > 0

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
            {/* Activating listening is the eye waking up (DESIGN_SYSTEM §21). */}
            <Symbol size={120} wake watch breathe className={styles.eye} />
            <p className={styles.arrivingLine}>{t.listening.arriving}</p>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        {/* DESIGN_SYSTEM §24: the interruption, only when there is something.
            No counts on the page itself: silence is the normal state. */}
        {vm.unseenOpportunities > 0 && (
          <div className={styles.found}>
            <p className={styles.foundTitle}>{t.opportunities.foundTitle}</p>
            <p className={styles.foundLead}>{t.opportunities.foundLead}</p>
            <Link href="/opportunities" className="btn">
              {t.opportunities.seeIt}
            </Link>
          </div>
        )}
        <div className={styles.center}>
          <Symbol size={104} watch breathe label={t.listening.label} className={styles.eye} />
          <p className="kicker">{t.listening.label}</p>
          <p className={styles.statusLine}>
            {t.listening.status}
          </p>
          <div className={styles.listeningFor}>
            <p className="kicker">{t.listening.currentlyFor}</p>
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
                  ? t.listening.confirmIntent
                  : hasRevealed
                    ? t.listening.notInOwnWords
                    : t.listening.nothingYet}
              </p>
            )}

            {hasRevealed && (
              <div className={styles.revealed}>
                <p className="kicker">{t.listening.fromChoices}</p>
                <RevealedGroup label={t.listening.wontConsider} items={wontConsider} />
                <RevealedGroup label={t.listening.weighs} items={weighs} />
                <RevealedGroup label={t.listening.money} items={money} />
                <RevealedGroup label={t.listening.notFiltering} items={vm.revealed.notFilteringOn} muted />
              </div>
            )}

            <div className={styles.changeIntent}>
              <Link href="/me/intent" className="text-btn">
                {t.listening.change}
              </Link>
              <Link href="/me/triage" className="text-btn">
                {vm.pendingReview > 0
                  ? t.listening.toReview(vm.pendingReview)
                  : vm.revealed.staleCount > 0
                    ? t.listening.stale
                    : t.listening.testTrade}
              </Link>
            </div>
          </div>
        </div>

        <div className={styles.repSummary}>
          <p className={styles.repLabel}>{t.common.yourRep}</p>
          <p className={styles.repCount}>{t.listening.evidence(vm.evidenceCount)}</p>
          <p className={styles.repCount}>{t.listening.capabilities(vm.capabilitiesCount)}</p>
          <Link href="/me" className={`text-btn ${styles.repLink}`}>
            {t.listening.viewMap}
          </Link>
        </div>
      </main>
    </>
  )
}
