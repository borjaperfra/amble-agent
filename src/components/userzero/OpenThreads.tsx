'use client'

import { useState } from 'react'
import styles from './OpenThreads.module.css'
import type { Language } from '@/lib/copy'

export interface OpenThread {
  id: string
  side: 'rep' | 'candidate'
  text: string
}

const COPY = {
  es: {
    kicker: 'Queda pendiente',
    rep: 'Te dije',
    candidate: 'Dijiste que',
    drop: 'Ya no',
    lead: 'Se cierra solo cuando me cuentas algo que lo cubre.',
  },
  en: {
    kicker: 'Still open',
    rep: 'I said',
    candidate: 'You said you would',
    drop: 'Not any more',
    lead: 'It closes itself when you tell me something that covers it.',
  },
} as const

interface OpenThreadsProps {
  threads: OpenThread[]
  language: Language
}

/**
 * Lo que sigue en pie entre los dos.
 *
 * No es una lista de tareas y no lleva casillas a propósito: lo que la cierra
 * es contarle algo que la cubra, no marcarla. Marcar una casilla es decir que
 * lo has hecho; contárselo es que además lo sepa, y entonces cambia lo que
 * piensa de las ofertas que tiene en el aire.
 *
 * Sí lleva un «ya no», porque lo único que se cierra solo es lo que se
 * cumple. Un consejo puede dejar de venir a cuento sin haberse cumplido —
 * cambiaste de idea, o el consejo era malo— y sin una puerta para eso se
 * queda abierto para siempre, entra en cada prompt, y el Rep lo repite hasta
 * que deja de leerse.
 */
export default function OpenThreads({ threads, language }: OpenThreadsProps) {
  const words = COPY[language] ?? COPY.es
  const [open, setOpen] = useState(threads)

  if (open.length === 0) return null

  async function drop(id: string) {
    const previous = open
    setOpen((current) => current.filter((thread) => thread.id !== id))
    try {
      const response = await fetch(`/api/advice?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('no')
    } catch {
      setOpen(previous)
    }
  }

  return (
    <section className={styles.box} aria-label={words.kicker}>
      <p className="kicker">{words.kicker}</p>
      <p className={styles.lead}>{words.lead}</p>
      <ul className={styles.list}>
        {open.map((thread) => (
          <li key={thread.id} className={styles.item}>
            <p className={styles.text}>
              <span className={styles.who}>
                {thread.side === 'rep' ? words.rep : words.candidate}
              </span>{' '}
              {thread.text}
            </p>
            <button type="button" className={styles.drop} onClick={() => drop(thread.id)}>
              {words.drop}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
