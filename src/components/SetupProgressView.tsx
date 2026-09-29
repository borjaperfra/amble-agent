'use client'

import StatusDot from '@/components/StatusDot'
import { useT } from '@/components/I18nProvider'
import type { SetupProgress } from '@/lib/pipeline/setup'
import styles from './SetupProgressView.module.css'

// How far the reading of what they shared has got: a bar that moves, what
// was found as it comes, and their capabilities once they are weighed.
// Roughly: reading is the first half, weighing most of the rest.
function share(progress: SetupProgress): number {
  const elapsed = (Date.now() - progress.startedAt) / 1000
  if (progress.stage === 'reading') {
    const byTime = Math.min(0.45, (elapsed / 60) * 0.45)
    return Math.max(byTime, progress.sources > 0 ? (progress.read / progress.sources) * 0.45 : 0.45)
  }
  if (progress.stage === 'weighing') return Math.min(0.85, 0.5 + (elapsed / 120) * 0.35)
  if (progress.stage === 'questions') return 0.92
  return 1
}

export default function SetupProgressView({ progress }: { progress: SetupProgress }) {
  const p = useT().setup
  const label = progress.stage === 'reading' ? p.reading : progress.stage === 'weighing' ? p.weighing : p.questions
  return (
    <section className={styles.wrap} role="status" aria-live="polite">
      <StatusDot />
      <p className={styles.label}>{label}</p>
      <div className={styles.bar} aria-hidden="true">
        <span style={{ width: `${Math.round(share(progress) * 100)}%` }} />
      </div>
      <p className={styles.hint}>{p.hint}</p>

      {progress.found.length > 0 && (
        <div className={styles.block}>
          <h2 className={styles.blockTitle}>{p.found}</h2>
          <ul className={styles.found}>
            {progress.found.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {progress.capabilities.length > 0 && (
        <div className={styles.block}>
          <h2 className={styles.blockTitle}>{p.capabilities(progress.capabilities.length)}</h2>
          <ul className={styles.capabilities}>
            {progress.capabilities.map((capability) => (
              <li key={capability.name}>{capability.name}</li>
            ))}
          </ul>
        </div>
      )}

      {progress.rejected.map((item) => (
        <p key={item.name} className={styles.rejected}>
          {p.rejected(item.name, item.reason)}
        </p>
      ))}
    </section>
  )
}
