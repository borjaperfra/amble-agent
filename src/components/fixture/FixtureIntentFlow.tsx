'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Header from '@/components/Header'
import InlineEdit from '@/components/InlineEdit'
import TranscriptReview from '@/components/TranscriptReview'
import VoiceRecorder from '@/components/VoiceRecorder'
import { intentInterpretation, intentPrompt } from '@/fixtures/intent'
import type { IntentGroup } from '@/domains/candidate/types'
import styles from '@/app/me/intent/intent.module.css'

type Stage = 'ask' | 'reveal'

export default function FixtureIntentFlow() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('ask')
  const [captured, setCaptured] = useState<string | null>(null)
  const [groups, setGroups] = useState<IntentGroup[]>(intentInterpretation.groups)
  const [hint, setHint] = useState(false)

  function confirm() {
    try {
      window.sessionStorage.setItem('amble-listening-activated', '1')
    } catch {
      // Session storage unavailable; the Listening screen still works.
    }
    router.push('/listening')
  }

  function updateValue(groupId: string, index: number, value: string) {
    setGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? {
              ...group,
              values: group.values.map((v, i) => (i === index ? value : v)),
            }
          : group,
      ),
    )
  }

  if (stage === 'ask') {
    return (
      <>
        <Header />
        <main className={styles.page}>
          <div className={styles.ask}>
            <p className="kicker">Your Rep</p>
            <p className={styles.lead}>{intentPrompt.lead}</p>
            <h1 className={styles.question}>{intentPrompt.question}</h1>
            {captured === null ? (
              <div className={styles.recorderArea}>
                <VoiceRecorder
                  fixtureTranscript={intentPrompt.fixtureTranscript}
                  onCapture={setCaptured}
                />
              </div>
            ) : (
              <div className={styles.reviewArea}>
                <TranscriptReview
                  value={captured}
                  onChange={setCaptured}
                  onKeep={() => setStage('reveal')}
                  onDiscard={() => setCaptured(null)}
                />
              </div>
            )}
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <div className={styles.reveal}>
          <p className="kicker">Your Rep</p>
          <h1 className={styles.revealLead}>{intentInterpretation.lead}</h1>
        </div>

        <div className={styles.groups}>
          {groups.map((group, groupIndex) => (
            <section
              key={group.id}
              className={styles.group}
              style={{ animationDelay: `${120 + groupIndex * 90}ms` }}
              aria-label={group.label}
            >
              <h2 className={styles.groupLabel}>{group.label}</h2>
              <div className={styles.values}>
                {group.values.map((value, valueIndex) => (
                  <div key={`${group.id}-${valueIndex}`} className={styles.value}>
                    <InlineEdit
                      value={value}
                      label={`${group.label} value`}
                      onChange={(next) => updateValue(group.id, valueIndex, next)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={styles.confirm}>
          <p className={styles.confirmQuestion}>{intentInterpretation.confirm}</p>
          <div className={styles.confirmActions}>
            <button type="button" className="btn" onClick={confirm}>
              {intentInterpretation.primary}
            </button>
            <button
              type="button"
              className="text-btn"
              aria-expanded={hint}
              onClick={() => setHint(true)}
            >
              {intentInterpretation.secondary}
            </button>
            {hint && <p className={styles.hint}>{intentInterpretation.secondaryHint}</p>}
          </div>
        </div>
      </main>
    </>
  )
}
