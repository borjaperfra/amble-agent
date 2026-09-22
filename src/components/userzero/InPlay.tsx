'use client'

import { useState } from 'react'
import styles from './InPlay.module.css'
import type { InPlayView } from '@/lib/in-play'
import type { Language } from '@/lib/copy'

const COPY = {
  es: {
    kicker: 'En marcha',
    since: (when: string) => `Dijiste que sí el ${when}`,
    waiting:
      'Todavía no puedo hablar con ellos por ti. Cuando pueda, esto empieza aquí — y te lo cuento antes de decir nada.',
    heldOne: '1 más está parada porque me falta algo para decidir.',
    heldMany: (count: number) => `${count} más están paradas porque me falta algo para decidir.`,
    show: 'Ver cuáles',
    hide: 'Dejarlo',
    heldNote: 'No hace falta que hagas nada con esto: es cosa mía.',
  },
  en: {
    kicker: 'In play',
    since: (when: string) => `You said yes on ${when}`,
    waiting:
      "I can't talk to them on your behalf yet. When I can, this starts here — and I'll tell you before I say anything.",
    heldOne: "1 more is stuck because I'm missing something before I can decide.",
    heldMany: (count: number) => `${count} more are stuck because I'm missing something to decide.`,
    show: 'See which',
    hide: 'Leave it',
    heldNote: 'Nothing for you to do with these: they are mine.',
  },
} as const

/**
 * Lo que está en marcha, y lo que está parado, tratados distinto.
 *
 * Lo que él puso en marcha va entero y por delante: dijo que sí y tiene
 * derecho a saber qué ha pasado desde entonces, aunque la respuesta honesta
 * hoy sea que nada. Un «sí» que desaparece en un agujero es peor que no
 * haberle preguntado.
 *
 * Lo que está en espera va como una cuenta y plegado. Es un problema del Rep
 * —le falta algo para decidir— y desplegarlo por defecto sería devolverle el
 * trabajo que este producto existe para quitarle. Se puede abrir, porque no
 * enseñárselo si lo pide sería otra cosa distinta.
 */
export default function InPlay({ view, language }: { view: InPlayView; language: Language }) {
  const words = COPY[language] ?? COPY.es
  const [open, setOpen] = useState(false)

  if (view.inPlay.length === 0 && view.held.length === 0) return null

  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(language === 'en' ? 'en-GB' : 'es-ES', {
      day: 'numeric',
      month: 'long',
    })

  return (
    <section className={styles.box} aria-label={words.kicker}>
      <p className="kicker">{words.kicker}</p>

      {view.inPlay.map((item) => (
        <article key={item.id} className={styles.item}>
          <h3 className={styles.role}>
            {item.role} <span className={styles.company}>· {item.company}</span>
          </h3>
          <p className={styles.since}>{words.since(day(item.since))}</p>
          <p className={styles.status}>{words.waiting}</p>
          {item.url ? (
            <a className={`text-btn ${styles.link}`} href={item.url} target="_blank" rel="noreferrer">
              {item.url.replace(/^https?:\/\//, '').slice(0, 44)} →
            </a>
          ) : null}
        </article>
      ))}

      {view.held.length > 0 ? (
        <div className={styles.held}>
          <p className={styles.heldLead}>
            {view.held.length === 1 ? words.heldOne : words.heldMany(view.held.length)}{' '}
            <button
              type="button"
              className={`text-btn ${styles.toggle}`}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? words.hide : words.show}
            </button>
          </p>
          {open ? (
            <>
              <ul className={styles.heldList}>
                {view.held.map((item) => (
                  <li key={item.id} className={styles.heldItem}>
                    <p className={styles.heldRole}>
                      {item.role} <span className={styles.company}>· {item.company}</span>
                    </p>
                    <p className={styles.heldWhy}>{item.blockedBy}</p>
                  </li>
                ))}
              </ul>
              <p className={styles.heldNote}>{words.heldNote}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
