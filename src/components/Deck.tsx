'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from './I18nProvider'
import styles from './Deck.module.css'

// Offers one at a time, like cards on a table: the one in front, where it
// sits among the rest, and the way to the next. Answering one takes it off
// the pile and the next comes forward; ← and → move without answering.

interface DeckProps<T> {
  items: T[]
  itemKey: (item: T) => string
  render: (item: T) => React.ReactNode
  // Marks a dot, for items with something going on (being prepared).
  busy?: (item: T) => boolean
  // Asked from outside: bring this one to the front.
  focus?: string | null
  label: string
}

export default function Deck<T>({ items, itemKey, render, busy, focus, label }: DeckProps<T>) {
  const t = useT().deck
  const deckRef = useRef<HTMLElement>(null)
  const [current, setCurrent] = useState<string | null>(items[0] ? itemKey(items[0]) : null)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')

  // The one in front, found by its key: when it leaves the pile, the one that
  // took its place comes forward, or the last if it was the last.
  const found = current === null ? -1 : items.findIndex((item) => itemKey(item) === current)
  const [lastIndex, setLastIndex] = useState(0)
  const index = found >= 0 ? found : Math.min(lastIndex, items.length - 1)
  if (found >= 0 && found !== lastIndex) setLastIndex(found)
  const item = index >= 0 ? items[index] : undefined
  const key = item ? itemKey(item) : null
  if (key !== current) setCurrent(key)

  const [asked, setAsked] = useState<string | null>(null)
  if (focus && focus !== asked) {
    setAsked(focus)
    if (items.some((entry) => itemKey(entry) === focus)) setCurrent(focus)
  }

  function go(step: number) {
    const next = index + step
    if (next < 0 || next >= items.length) return
    setDirection(step > 0 ? 'forward' : 'back')
    setCurrent(itemKey(items[next]))
  }

  // A new card in front, and the reader was further down the last one: back
  // to the top of the deck, gently, so the next one is read from its start.
  const shown = useRef(key)
  useEffect(() => {
    if (shown.current === key) return
    shown.current = key
    const top = deckRef.current?.getBoundingClientRect().top ?? 0
    if (top < 0) deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [key])

  // Arrows move through the pile, unless the person is writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.key === 'ArrowRight') go(1)
      if (event.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!item) return null

  return (
    <section ref={deckRef} className={styles.deck} aria-label={label} aria-roledescription={t.roledescription}>
      <div className={styles.bar}>
        <button type="button" className={styles.arrow} onClick={() => go(-1)} disabled={index === 0} aria-label={t.previous}>
          ←
        </button>
        <p className={styles.position} aria-live="polite">
          {t.position(index + 1, items.length)}
        </p>
        <button type="button" className={styles.arrow} onClick={() => go(1)} disabled={index === items.length - 1} aria-label={t.next}>
          →
        </button>
      </div>

      <div className={direction === 'forward' ? `${styles.card} ${styles.forward}` : `${styles.card} ${styles.back}`} key={key}>
        {render(item)}
      </div>

      {items.length > 1 && (
        <div className={styles.dots} role="tablist" aria-label={label}>
          {items.map((entry, position) => {
            const entryKey = itemKey(entry)
            const classes = [styles.dot, position === index ? styles.dotCurrent : '', busy?.(entry) ? styles.dotBusy : '']
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={entryKey}
                type="button"
                role="tab"
                aria-selected={position === index}
                aria-label={t.position(position + 1, items.length)}
                className={classes}
                onClick={() => {
                  setDirection(position > index ? 'forward' : 'back')
                  setCurrent(entryKey)
                }}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
