'use client'

import Link from 'next/link'
import { useState } from 'react'
import CapabilityBlock from '@/components/CapabilityBlock'
import EvidenceDrawer from '@/components/EvidenceDrawer'
import Header from '@/components/Header'
import type { Capability } from '@/domains/candidate/types'
import type { MapViewModel } from '@/lib/view'
import { EvaluationControl } from './EvaluationControl'
import styles from '@/app/me/me.module.css'

interface MapViewProps {
  vm: MapViewModel
}

export default function UserZeroMapView({ vm }: MapViewProps) {
  const [openCapability, setOpenCapability] = useState<Capability | null>(null)

  const hasContent = vm.capabilities.length > 0

  return (
    <>
      <Header />
      <main className={styles.page}>
        <section className={styles.intro} aria-labelledby="map-name">
          <div className={styles.introKicker}>
            <p className="kicker">Your professional map</p>
          </div>
          <h1 id="map-name" className={styles.name}>
            {vm.name ?? 'Your name will appear once your Rep reads a source.'}
          </h1>
          <p className={styles.headline}>
            {vm.descriptor ?? 'Your Rep is still forming a picture of your work.'}
          </p>
          <p className={styles.updated}>{vm.updated}</p>
        </section>

        <section className={styles.section} aria-labelledby="demonstrates">
          <p id="demonstrates" className={`kicker ${styles.sectionKicker}`}>
            What your work demonstrates
          </p>
          {hasContent ? (
            <div className={styles.blocks}>
              {vm.capabilities.map((capability) => (
                <div key={capability.id}>
                  <CapabilityBlock
                    name={capability.name}
                    strength={capability.strength}
                    explanation={capability.explanation}
                    count={capability.count}
                    onView={() =>
                      setOpenCapability({
                        id: capability.id,
                        name: capability.name,
                        strength: capability.strength,
                        explanation: capability.explanation,
                      })
                    }
                  />
                  <EvaluationControl
                    targetType="capability"
                    targetId={capability.id}
                    label="Evaluate"
                    verdicts={['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.headline}>
              {vm.counts.sources === 0
                ? 'There is nothing here yet. Give your Rep a source to read and it will start building your map.'
                : 'Your Rep has read your sources but cannot yet demonstrate any capability from them. That is an honest result — talk to your Rep to go deeper.'}
            </p>
          )}
        </section>

        {vm.distinctive && vm.distinctive.length >= 2 && (
          <section className={styles.distinctive} aria-labelledby="distinctive">
            <p id="distinctive" className="kicker" style={{ marginBottom: 40 }}>
              Your distinctive profile
            </p>
            <p className={styles.distinctiveLine}>
              {vm.distinctive.map((name, index) => (
                <span key={name} style={{ display: 'block' }}>
                  {index > 0 && (
                    <span className={styles.distinctiveCross} aria-hidden="true">
                      ×
                    </span>
                  )}
                  {index > 0 && <span className="visually-hidden">combined with </span>}
                  {name}
                </span>
              ))}
            </p>
          </section>
        )}

        {vm.distinctive === null && hasContent && (
          <section className={styles.distinctive} aria-labelledby="distinctive-empty">
            <p id="distinctive-empty" className="kicker" style={{ marginBottom: 20 }}>
              Your distinctive profile
            </p>
            <p className={styles.headline} style={{ textAlign: 'center' }}>
              I can&apos;t describe what makes your profile distinctive yet — there isn&apos;t
              enough strong evidence. That&apos;s not a flaw in you; it&apos;s what I know so far.
            </p>
          </section>
        )}

        {vm.gaps.length > 0 && (
          <section className={styles.section} aria-labelledby="gaps">
            <p id="gaps" className={`kicker ${styles.sectionKicker}`}>
              Things I don&apos;t know yet
            </p>
            <div className={styles.gaps}>
              {vm.gaps.map((gap) => (
                <article key={gap.id} className={styles.gap}>
                  <h3 className={styles.gapName}>{gap.name}</h3>
                  <p className={styles.gapExplanation}>{gap.explanation}</p>
                  <Link href="/onboarding/interview" className={`text-btn ${styles.gapAction}`}>
                    Talk it through with your Rep →
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className={styles.outro} aria-labelledby="outro">
          <p id="outro" className="kicker">
            One more thing
          </p>
          <h2 className={styles.outroTitle}>
            Tell your Rep what would make something worth your attention.
          </h2>
          <div className={styles.outroCta}>
            <Link href="/me/intent" className="btn">
              Set what I&apos;m listening for →
            </Link>
          </div>
          <p className={styles.privacy}>
            This map is private. Only you can see it. Built from {vm.counts.claims} extracted
            claims, {vm.counts.evidence} pieces of evidence and {vm.counts.sources} source
            {vm.counts.sources === 1 ? '' : 's'} — every one inspectable.
          </p>
        </section>
      </main>

      {openCapability && (
        <EvidenceDrawer
          capability={openCapability}
          showEpistemicState
          items={
            vm.capabilities.find((capability) => capability.id === openCapability.id)?.evidence ?? []
          }
          onClose={() => setOpenCapability(null)}
        />
      )}
    </>
  )
}
