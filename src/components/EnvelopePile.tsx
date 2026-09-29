'use client'

import Link from 'next/link'
import { useT } from '@/components/I18nProvider'
import type { PileEnvelope } from '@/lib/view'
import styles from './EnvelopePile.module.css'

// What is still in their hands, resting on the listening horizon where the
// tumbleweed rolls when there is nothing: one envelope per offer, the size of
// the tumbleweed and drawn in the same loose line. New ones are sealed, the
// ones they want lie open with the letter showing, sent ones carry a stamp.
// Hovered, an envelope lifts and says what it is; clicked, it opens the tab
// it belongs to.

const SHOWN = 7
// A hand-dropped pile: each envelope a little askew, never in a pattern.
const TILT = [-4, 3, -2, 5, -3, 2, -5]
const RISE = [0, 2, 0, 3, 0, 1, 2]

export default function EnvelopePile({ items }: { items: PileEnvelope[] }) {
  const t = useT()
  const p = t.listening.pile
  const shown = items.slice(0, SHOWN)
  const more = items.length - shown.length

  return (
    <div className={styles.pile} role="list" aria-label={p.label(items.length)}>
      {shown.map((item, index) => (
        <div role="listitem" key={`${item.kind}-${item.id}`} className={styles.slot}>
          <Link
            href={`/opportunities?tab=${item.kind}`}
            className={`${styles.envelope} ${styles[item.kind]}`}
            style={
              {
                '--tilt': `${TILT[index % TILT.length]}deg`,
                '--rise': `${RISE[index % RISE.length]}px`,
                '--delay': `${120 + index * 90}ms`,
              } as React.CSSProperties
            }
            aria-label={`${p.kinds[item.kind]}: ${item.company} — ${item.title}`}
          >
            <span className={styles.shadow} aria-hidden="true" />
            <svg className={styles.drawing} viewBox="0 0 30 26" width={46} height={40} aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                {/* The letter, drawn only where it shows above the envelope once open. */}
                <path className={styles.letter} strokeWidth="0.75" d="M7.5 17V6.5H22.5V17M10 9.5H19M10 12H17" />
                {/* The body, never quite square: drawn by hand, like the tumbleweed. */}
                <path className={styles.body} strokeWidth="1.05" d="M3.5 11.5C3.3 15.5 3.4 19.5 3.8 23.2C11 23.6 19 23.5 26.3 23C26.6 19 26.6 15 26.4 11.3C19 11 11 11.1 3.5 11.5Z" />
                {/* The front fold. */}
                <path strokeWidth="0.75" d="M3.9 22.8L12.5 16.8M26 22.6L17.6 16.7" />
                {/* The flap: down and closed, or up and open. */}
                <path className={styles.flapClosed} strokeWidth="0.75" d="M3.6 11.6C7.5 14.5 11 17.2 15 18.8C19 17.1 22.6 14.4 26.3 11.4" />
                <path className={styles.flapOpen} strokeWidth="0.75" d="M3.6 11.5C7.5 8.5 11 5.6 15 3.5C19 5.5 22.6 8.4 26.3 11.3" />
              </g>
              {item.kind === 'new' && <circle className={styles.seal} cx="15" cy="18.4" r="1.9" fill="currentColor" />}
              {item.kind === 'sent' && (
                <path
                  className={styles.stamp}
                  d="M20.3 14.6H24V18.9H20.3Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeDasharray="0.9 0.9"
                />
              )}
            </svg>
            <span className={styles.tag} aria-hidden="true">
              <span className={styles.kind}>{p.kinds[item.kind]}</span>
              <span className={styles.company}>{item.company}</span>
              <span className={styles.title}>{item.title}</span>
            </span>
          </Link>
        </div>
      ))}
      {more > 0 && (
        <Link href="/opportunities" className={styles.more}>
          {p.more(more)}
        </Link>
      )}
    </div>
  )
}
