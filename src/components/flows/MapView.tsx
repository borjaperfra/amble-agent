'use client'

import Link from 'next/link'
import { useState } from 'react'
import CapabilityBlock from '@/components/CapabilityBlock'
import EvidenceDrawer from '@/components/EvidenceDrawer'
import Header from '@/components/Header'
import { useT } from '@/components/I18nProvider'
import type { Capability } from '@/domains/candidate/types'
import type { MapViewModel } from '@/lib/view'
import { EvaluationControl } from './EvaluationControl'
import styles from '@/app/me/me.module.css'

interface MapViewProps {
  vm: MapViewModel
}

export default function MapView({ vm }: MapViewProps) {
  const t = useT()
  const [openCapability, setOpenCapability] = useState<Capability | null>(null)

  const hasContent = vm.capabilities.length > 0

  return (
    <>
      <Header />
      <main className={styles.page}>
        <section className={styles.intro} aria-labelledby="map-name">
          <div className={styles.introKicker}>
            <p className="kicker">{t.map.kicker}</p>
          </div>
          <h1 id="map-name" className={styles.name}>
            {vm.name ?? t.map.noName}
          </h1>
          <p className={styles.headline}>
            {vm.descriptor ?? t.map.noDescriptor}
          </p>
          <p className={styles.updated}>{vm.updated}</p>
        </section>

        <section className={styles.section} aria-labelledby="demonstrates">
          <p id="demonstrates" className={`kicker ${styles.sectionKicker}`}>
            {t.map.demonstrates}
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
                    label={t.map.evaluate}
                    verdicts={['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.headline}>
              {vm.counts.sources === 0
                ? t.map.emptyNoSources
                : t.map.emptyWithSources}
            </p>
          )}
        </section>

        {vm.distinctive && vm.distinctive.length >= 2 && (
          <section className={styles.distinctive} aria-labelledby="distinctive">
            <p id="distinctive" className="kicker" style={{ marginBottom: 40 }}>
              {t.map.distinctive}
            </p>
            <p className={styles.distinctiveLine}>
              {vm.distinctive.map((name, index) => (
                <span key={name} style={{ display: 'block' }}>
                  {index > 0 && (
                    <span className={styles.distinctiveCross} aria-hidden="true">
                      ×
                    </span>
                  )}
                  {index > 0 && <span className="visually-hidden">{t.map.combinedWith}</span>}
                  {name}
                </span>
              ))}
            </p>
          </section>
        )}

        {vm.distinctive === null && hasContent && (
          <section className={styles.distinctive} aria-labelledby="distinctive-empty">
            <p id="distinctive-empty" className="kicker" style={{ marginBottom: 20 }}>
              {t.map.distinctive}
            </p>
            <p className={styles.headline} style={{ textAlign: 'center' }}>
              {t.map.distinctiveEmpty}
            </p>
          </section>
        )}

        {vm.gaps.length > 0 && (
          <section className={styles.section} aria-labelledby="gaps">
            <p id="gaps" className={`kicker ${styles.sectionKicker}`}>
              {t.map.gaps}
            </p>
            <div className={styles.gaps}>
              {vm.gaps.map((gap) => (
                <article key={gap.id} className={styles.gap}>
                  <h3 className={styles.gapName}>{gap.name}</h3>
                  <p className={styles.gapExplanation}>{gap.explanation}</p>
                  <Link href="/onboarding/interview" className={`text-btn ${styles.gapAction}`}>
                    {t.map.talkItThrough}
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className={styles.outro} aria-labelledby="outro">
          <p id="outro" className="kicker">
            {t.map.oneMore}
          </p>
          <h2 className={styles.outroTitle}>
            {t.map.outro}
          </h2>
          <div className={styles.outroCta}>
            <Link href="/me/intent" className="btn">
              {t.map.setListening}
            </Link>
          </div>
          <p className={styles.privacy}>
            {t.map.privacy(vm.counts.claims, vm.counts.evidence, vm.counts.sources)}
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
