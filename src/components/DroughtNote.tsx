import Link from 'next/link'
import type { Drought } from '@/lib/matching/view'
import type { Dictionary } from '@/lib/i18n/dictionaries'
import styles from './DroughtNote.module.css'

// Why nothing reaches them yet, in their numbers: how many offers are open,
// how many are their kind of role, how many were read and what set those
// aside. Honest about a slow start instead of a silent empty page.
export default function DroughtNote({ drought, t }: { drought: Drought; t: Dictionary['drought'] }) {
  const line = (reason: Drought['reasons'][number]) => {
    if (reason.kind === 'role') return t.role(reason.count)
    if (reason.kind === 'place') return t.place(reason.count)
    if (reason.kind === 'pay') return t.pay(reason.count)
    if (reason.kind === 'language') return t.language(reason.count)
    if (reason.kind === 'unread') return t.unread(reason.count)
    return t.rule(reason.count, reason.rule ?? '')
  }
  return (
    <section className={styles.note} aria-labelledby="drought-title">
      <h2 id="drought-title" className={styles.title}>
        {t.title}
      </h2>
      {drought.open > 0 && <p>{t.pool(drought.open, drought.ofTheirRole)}</p>}
      {drought.read > 0 ? (
        <>
          <p>{t.read(drought.read)}</p>
          <ul className={styles.reasons}>
            {drought.reasons.map((reason) => (
              <li key={`${reason.kind}-${reason.rule ?? ''}`}>{line(reason)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t.notYet}</p>
      )}
      {drought.waiting > 0 && <p className={styles.waiting}>{t.waiting(drought.waiting)}</p>}
      <Link href="/me/intent" className={`text-btn ${styles.change}`}>
        {t.change}
      </Link>
    </section>
  )
}
