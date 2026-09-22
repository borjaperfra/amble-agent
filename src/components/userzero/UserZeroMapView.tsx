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
import ProfileState from './ProfileState'

interface MapViewProps {
  vm: MapViewModel
}

/**
 * What the map rests on, in one line, in plain numbers.
 *
 * Deliberately not a percentage: a score invites arguing with the number
 * instead of answering the question underneath it, and there is no honest
 * denominator for "a professional life".
 */
function restsOn(vm: MapViewModel): string | null {
  const { completeness, counts } = vm
  if (counts.capabilities === 0) return null

  const parts: string[] = []
  parts.push(
    `Built from ${counts.sources} source${counts.sources === 1 ? '' : 's'} and ${counts.evidence} pieces of evidence`,
  )
  // Say exactly what the number counts: this is the assessment of how much
  // the evidence proves, not a tally of mentions.
  parts.push(
    completeness.solid > 0
      ? `${completeness.solid} of ${counts.capabilities} capabilities are held up by good or strong evidence`
      : `none of the ${counts.capabilities} capabilities are held up by good evidence yet`,
  )
  if (completeness.answeredQuestions > 0) {
    parts.push(
      `${completeness.answeredQuestions} question${completeness.answeredQuestions === 1 ? '' : 's'} answered in your own words`,
    )
  }
  if (completeness.openQuestions > 0) {
    parts.push(`${completeness.openQuestions} still open`)
  }
  return `${parts.join('. ')}.`
}

export default function UserZeroMapView({ vm }: MapViewProps) {
  const [openCapability, setOpenCapability] = useState<Capability | null>(null)

  const hasContent = vm.capabilities.length > 0
  const rests = restsOn(vm)

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
          {rests && <p className={styles.rests}>{rests}</p>}
        </section>

        {/* De dónde te conozco y qué me falta, arriba y no al final.
            Estaba todo calculado desde el principio pero debajo de dieciséis
            capacidades, que es como no estar: «no hay botones que te lleven a
            ello rápido ni una progresión en barra». */}
        <ProfileState
          completeness={vm.completeness}
          sources={vm.completeness.sources}
          openGaps={vm.gaps.length + vm.gapsHidden}
        />

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
            {vm.gapsHidden > 0 && (
              <p className={styles.gapsMore}>
                {vm.gapsHidden} more like these. I&apos;ll raise them as we talk rather than list
                them at you.
              </p>
            )}
          </section>
        )}

        {hasContent && (
          <section className={styles.section} aria-labelledby="stands">
            <p id="stands" className={`kicker ${styles.sectionKicker}`}>
              What would sharpen this
            </p>
            {/* Los pasos ya están arriba. Aquí sólo queda lo que decir
                cuando no hay ninguno, que es una frase que merece quedarse. */}
            {vm.completeness.steps.length === 0 ? (
              <p className={styles.stepsNone}>
                Nothing obvious. Everything I could ask about, I&apos;ve asked; everything you gave
                me, I&apos;ve read. This is as sharp as it gets without new work to read.
              </p>
            ) : (
              <p className={styles.stepsNone}>
                What would sharpen this is at the top of this page, where you can act on it.
              </p>
            )}
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
