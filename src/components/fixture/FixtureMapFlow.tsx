'use client'

import Link from 'next/link'
import { useState } from 'react'
import CapabilityBlock from '@/components/CapabilityBlock'
import EvidenceDrawer from '@/components/EvidenceDrawer'
import Header from '@/components/Header'
import {
  candidate,
  capabilities,
  evidenceFor,
  evidenceGaps,
} from '@/fixtures/candidate'
import type { Capability } from '@/domains/candidate/types'
import styles from '@/app/me/me.module.css'

type GapState = 'collapsed' | 'options' | 'noted'

export default function FixtureMapFlow() {
  const [openCapability, setOpenCapability] = useState<Capability | null>(null)
  const [gapStates, setGapStates] = useState<Record<string, GapState>>({})

  function setGapState(id: string, state: GapState) {
    setGapStates((prev) => ({ ...prev, [id]: state }))
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <section className={styles.intro} aria-labelledby="map-name">
          <div className={styles.introKicker}>
            <p className="kicker">Your professional map</p>
          </div>
          <h1 id="map-name" className={styles.name}>
            {candidate.name}
          </h1>
          <p className={styles.headline}>{candidate.headline}</p>
          <p className={styles.updated}>{candidate.updated}</p>
        </section>

        <section className={styles.section} aria-labelledby="demonstrates">
          <p id="demonstrates" className={`kicker ${styles.sectionKicker}`}>
            What your work demonstrates
          </p>
          <div className={styles.blocks}>
            {capabilities.map((capability) => (
              <CapabilityBlock
                key={capability.id}
                name={capability.name}
                strength={capability.strength}
                explanation={capability.explanation}
                count={evidenceFor(capability.id).length}
                onView={() => setOpenCapability(capability)}
              />
            ))}
          </div>
        </section>

        <section className={styles.distinctive} aria-labelledby="distinctive">
          <p id="distinctive" className="kicker" style={{ marginBottom: 40 }}>
            Your distinctive profile
          </p>
          <p className={styles.distinctiveLine}>
            {candidate.distinctive[0]}
            <span className={styles.distinctiveCross} aria-hidden="true">
              ×
            </span>
            <span className="visually-hidden">combined with</span>
            {candidate.distinctive[1]}
            <span className={styles.distinctiveCross} aria-hidden="true">
              ×
            </span>
            <span className="visually-hidden">combined with</span>
            {candidate.distinctive[2]}
          </p>
        </section>

        <section className={styles.section} aria-labelledby="gaps">
          <p id="gaps" className={`kicker ${styles.sectionKicker}`}>
            Things I don&rsquo;t know yet
          </p>
          <div className={styles.gaps}>
            {evidenceGaps.map((gap) => {
              const state = gapStates[gap.id] ?? 'collapsed'
              return (
                <article key={gap.id} className={styles.gap}>
                  <h3 className={styles.gapName}>{gap.name}</h3>
                  <p className={styles.gapExplanation}>{gap.explanation}</p>
                  {state === 'collapsed' && (
                    <button
                      type="button"
                      className={`text-btn ${styles.gapAction}`}
                      onClick={() => setGapState(gap.id, 'options')}
                    >
                      Strengthen this →
                    </button>
                  )}
                  {state === 'options' && (
                    <div className={styles.gapOptions}>
                      {gap.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={styles.gapOption}
                          onClick={() => setGapState(gap.id, 'noted')}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  {state === 'noted' && (
                    <p className={styles.gapNoted} role="status">
                      Noted. I&rsquo;ll ask you about this properly next time.
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        <section className={styles.outro} aria-labelledby="outro">
          <p id="outro" className="kicker">
            One more thing
          </p>
          <h2 className={styles.outroTitle}>
            Tell your Rep what would make something worth your attention.
          </h2>
          <div className={styles.outroCta}>
            <Link href="/me/intent" className="btn">
              Set what I&rsquo;m listening for →
            </Link>
          </div>
          <p className={styles.privacy}>
            This map is private. Only you can see it. Every claim can be inspected.
          </p>
        </section>
      </main>

      {openCapability && (
        <EvidenceDrawer
          capability={openCapability}
          items={evidenceFor(openCapability.id)}
          onClose={() => setOpenCapability(null)}
        />
      )}
    </>
  )
}
