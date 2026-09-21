'use client'

import { useState } from 'react'
import styles from './ToneLoop.module.css'
import type { Language } from '@/lib/copy'

const COPY = {
  es: {
    off: 'No me suena bien',
    what: 'Qué falla',
    how: 'Dímelo así',
    placeholder: 'Más corto. Sin listas. Como me lo diría un amigo que sabe del tema.',
    again: 'Dilo otra vez',
    working: 'Dándole otra vuelta…',
    keep: 'Y háblame siempre así',
    kept: 'Hecho: a partir de ahora te hablo así.',
    failed: 'No he podido decirlo de otra manera sin cambiar lo que digo. Se queda como estaba.',
    close: 'Déjalo',
    reasons: {
      robot: 'Suena a robot',
      long: 'Demasiado largo',
      jargon: 'Palabras raras',
      obvious: 'No me dice nada nuevo',
      cold: 'Demasiado frío',
      wrong: 'Eso no es verdad',
    } as Record<string, string>,
  },
  en: {
    off: "That doesn't sound right",
    what: "What's wrong",
    how: 'Say it like this',
    placeholder: 'Shorter. No lists. The way a friend who knows the field would put it.',
    again: 'Say it again',
    working: 'Having another go…',
    keep: 'And always talk to me like this',
    kept: "Done: that's how I'll talk to you from now on.",
    failed: "I couldn't say it differently without changing what I say. Leaving it as it was.",
    close: 'Leave it',
    reasons: {
      robot: 'Sounds like a robot',
      long: 'Too long',
      jargon: 'Odd words',
      obvious: 'Tells me nothing new',
      cold: 'Too cold',
      wrong: "That isn't true",
    } as Record<string, string>,
  },
} as const

interface ToneLoopProps {
  messageId: string
  language: Language
  /** Para pintar la respuesta nueva sin recargar nada. */
  onReworded: (answer: string) => void
}

/**
 * Decir qué falla, decir cómo lo quieres, y verlo otra vez.
 *
 * El bucle de tono de antes era: lo lees, me lo cuentas, cambio un prompt,
 * despliego, esperas tres minutos, vuelves a probar — y lo que quedaba de
 * cada vuelta era una impresión. Este es el mismo bucle en diez segundos y
 * dejando un dato.
 *
 * Los motivos son botones y no un campo de texto porque un motivo escrito a
 * mano no se puede contar: «suena a robot» ×8 sobre `answer_candidate_question
 * v5` se puede atacar, y ocho frases distintas que dicen lo mismo, no. El
 * campo libre sigue estando para lo que no cabe en seis botones.
 *
 * Y lo que se rehace son las palabras, no la respuesta: los puntos y sus
 * fuentes se quedan como estaban. Por eso se puede pulsar diez veces seguidas
 * sin pensar en la factura, y por eso probar un tono no puede hacer que el
 * Rep se invente nada.
 */
export default function ToneLoop({ messageId, language, onReworded }: ToneLoopProps) {
  const words = COPY[language] ?? COPY.es
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [tone, setTone] = useState('')
  const [state, setState] = useState<'idle' | 'working' | 'kept'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function send(remember: boolean) {
    setState('working')
    setError(null)
    try {
      const response = await fetch('/api/tone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          verdict: reason,
          comment: tone || null,
          tone,
          reword: tone.trim().length > 0,
          remember,
        }),
      })
      if (!response.ok) {
        setError(words.failed)
        setState('idle')
        return
      }
      const { answer } = (await response.json()) as { answer?: string }
      if (answer) onReworded(answer)
      setState(remember ? 'kept' : 'idle')
    } catch {
      setError(words.failed)
      setState('idle')
    }
  }

  if (!open) {
    return (
      <button type="button" className={`text-btn ${styles.open}`} onClick={() => setOpen(true)}>
        {words.off}
      </button>
    )
  }

  return (
    <section className={styles.box} aria-label={words.off}>
      <p className={styles.label}>{words.what}</p>
      <div className={styles.reasons}>
        {Object.entries(words.reasons).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${styles.chip} ${reason === key ? styles.chipOn : ''}`}
            aria-pressed={reason === key}
            onClick={() => setReason(reason === key ? null : key)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className={styles.label} htmlFor={`tone-${messageId}`}>
        {words.how}
      </label>
      <textarea
        id={`tone-${messageId}`}
        className={styles.input}
        value={tone}
        onChange={(event) => setTone(event.target.value)}
        rows={2}
        placeholder={words.placeholder}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.again}
          disabled={state === 'working' || tone.trim().length === 0}
          onClick={() => void send(false)}
        >
          {state === 'working' ? words.working : words.again}
        </button>
        <button
          type="button"
          className={`text-btn ${styles.keep}`}
          disabled={state === 'working' || tone.trim().length === 0}
          onClick={() => void send(true)}
        >
          {words.keep}
        </button>
        <button type="button" className={`text-btn ${styles.keep}`} onClick={() => setOpen(false)}>
          {words.close}
        </button>
      </div>

      {state === 'kept' ? <p className={styles.kept}>{words.kept}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
