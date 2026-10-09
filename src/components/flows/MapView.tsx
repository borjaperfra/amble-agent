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
import WhatsAppConnect from './WhatsAppConnect'
import { useSearchPause } from './useSearchPause'
import styles from '@/app/me/me.module.css'

export type MapNextStep = { kind: 'sources' | 'intent' | 'questions' | 'whatsapp' | 'done' }

interface MapViewProps {
  vm: MapViewModel
  next: MapNextStep
  // How good each reading is: for the owner, not for the candidate.
  owner: boolean
  // They paused the search until further notice.
  paused: boolean
  // Whether WhatsApp can be linked, and is: what is still unknown is asked there.
  whatsapp: { available: boolean; linked: boolean }
}

const NEXT_HREF: Record<'sources' | 'intent' | 'questions', string> = {
  sources: '/onboarding',
  intent: '/me/intent',
  questions: '/onboarding/interview',
}

// The gaps worth their time, not every one of them.
const GAPS_SHOWN = 3

export default function MapView({ vm, next, owner, paused: initiallyPaused, whatsapp }: MapViewProps) {
  const t = useT()
  const [openCapability, setOpenCapability] = useState<Capability | null>(null)
  const { paused, switching, note, toggle } = useSearchPause(initiallyPaused)
  // The search runs once they said what they are looking for (the two
  // questions can still be pending): only then is there one to pause.
  const searching = next.kind === 'questions' || next.kind === 'whatsapp' || next.kind === 'done' || paused
  const searchLine = note === 'failed' ? t.listening.pause.failed : paused ? t.listening.pause.line : note === 'resumed' ? t.listening.pause.resumed : null

  const hasContent = vm.capabilities.length > 0

  return (
    <>
      <Header />
      <main className={styles.page}>
        {next.kind !== 'done' && next.kind !== 'whatsapp' && (
          <section className={styles.next} aria-labelledby="next-step">
            <p id="next-step" className="kicker">
              {t.map.nextStep}
            </p>
            <h2 className={styles.nextTitle}>{t.map.next[next.kind].title}</h2>
            <p className={styles.nextLead}>{t.map.next[next.kind].lead}</p>
            <Link href={NEXT_HREF[next.kind]} className="btn">
              {t.map.next[next.kind].action}
            </Link>
          </section>
        )}

        {searching && (
          <section className={styles.search} aria-labelledby="search-status">
            <p id="search-status" className={styles.searchStatus}>
              <span className={paused ? styles.searchStill : styles.searchPulse} aria-hidden="true" />
              {paused ? t.listening.pause.status : t.listening.listeningOffers}
            </p>
            <p className={styles.searchLine} role="status">
              {searchLine}
            </p>
            {paused ? (
              <button type="button" className={next.kind === 'done' ? 'btn' : 'btn btn-quiet'} onClick={toggle} disabled={switching}>
                {t.listening.pause.resume}
              </button>
            ) : (
              <button type="button" className={styles.pauseToggle} onClick={toggle} disabled={switching}>
                {t.listening.pause.pause}
              </button>
            )}
          </section>
        )}

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

        {vm.distinctive && vm.distinctive.length >= 2 && (
          <section className={styles.distinctive} aria-labelledby="distinctive">
            <p id="distinctive" className="kicker" style={{ marginBottom: 16 }}>
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
            <p id="distinctive-empty" className="kicker" style={{ marginBottom: 12 }}>
              {t.map.distinctive}
            </p>
            <p className={styles.headline} style={{ textAlign: 'center' }}>
              {t.map.distinctiveEmpty}
            </p>
          </section>
        )}

        {/* How much is still unknown, near the top: tapping it goes to them. */}
        {vm.gaps.length > 0 && (
          <a href="#gaps" className={styles.gapsSummary}>
            <span className={styles.gapsSummaryLine}>{t.map.gapsSummary(Math.min(vm.gaps.length, GAPS_SHOWN))}</span>
            <span className={styles.gapsSummaryHow}>{whatsapp.linked ? t.map.gapsHowLinked : t.map.gapsHow}</span>
            <span className={styles.gapsSummaryAction}>{t.map.gapsSee}</span>
          </a>
        )}

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
                  {owner && (
                    <EvaluationControl
                      targetType="capability"
                      targetId={capability.id}
                      label={t.map.evaluate}
                      verdicts={['ACCURATE', 'PARTIALLY_ACCURATE', 'WRONG', 'UNSUPPORTED']}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <p className={styles.headline}>{vm.counts.sources === 0 ? t.map.emptyNoSources : t.map.emptyWithSources}</p>
              {/* Somewhere to go from here: sharing more, unless that is already the next step above. */}
              {next.kind !== 'sources' && (
                <Link href="/onboarding" className="text-btn">
                  {t.map.next.sources.action}
                </Link>
              )}
            </div>
          )}
        </section>

        {/* Past the setup, with nothing worth asking left: said, not left blank (#22). */}
        {vm.gaps.length === 0 && (next.kind === 'whatsapp' || next.kind === 'done') && (
          <section className={`${styles.section} ${styles.gapsSection}`}>
            <p className={styles.gapsNote}>{t.map.noGaps}</p>
          </section>
        )}

        {vm.gaps.length > 0 && (
          <section className={`${styles.section} ${styles.gapsSection}`} aria-labelledby="gaps">
            <p id="gaps" className={`kicker ${styles.sectionKicker}`}>
              {t.map.gaps}
            </p>
            <div className={styles.gaps}>
              {vm.gaps.slice(0, GAPS_SHOWN).map((gap) => (
                <article key={gap.id} className={styles.gap}>
                  <h3 className={styles.gapName}>{gap.name}</h3>
                  <p className={styles.gapExplanation}>{gap.explanation}</p>
                </article>
              ))}
            </div>
            {/* Answered here: the questions on what is still unknown. Only once
                the setup is done (before, its own questions come first). */}
            {(next.kind === 'whatsapp' || next.kind === 'done') && (
              <Link href="/onboarding/interview" className={`btn btn-quiet ${styles.answerHere}`}>
                {t.map.answerHere}
              </Link>
            )}
            {whatsapp.linked ? (
              <p className={styles.gapsNote}>{t.map.gapsLater}</p>
            ) : (
              whatsapp.available && (
                <div className={styles.gapsConnect}>
                  <p className={styles.gapsNote}>{t.map.gapsConnect}</p>
                  <WhatsAppConnect linked={false} compact />
                </div>
              )
            )}
          </section>
        )}

        <section className={styles.outro} aria-labelledby={next.kind === 'intent' ? undefined : 'outro'}>
          {/* Already the next step at the top: not asked twice. */}
          {next.kind !== 'intent' && (
            <>
              <p id="outro" className="kicker">
                {t.map.oneMore}
              </p>
              <h2 className={styles.outroTitle}>{t.map.outro}</h2>
              <div className={styles.outroCta}>
                <Link href="/me/intent" className="btn">
                  {t.map.setListening}
                </Link>
              </div>
            </>
          )}
          <p className={styles.privacy}>{t.map.privacy(vm.counts.claims, vm.counts.evidence, vm.counts.sources)}</p>
          {/* A newer CV, or what they did not share the first time: always one tap away. */}
          {vm.counts.sources > 0 && (
            <Link href="/onboarding" className="text-btn">
              {t.map.addDocument}
            </Link>
          )}
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
