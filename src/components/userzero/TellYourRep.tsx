'use client'

import { useState } from 'react'
import VoiceRecorder from '../VoiceRecorder'
import styles from './TellYourRep.module.css'
import type { Language } from '@/lib/copy'

const COPY = {
  es: {
    kicker: 'Cuéntame algo',
    lead: 'Lo que me digas se suma a lo que sé de ti, aunque no venga a cuento de nada. No hace falta que sea sobre una oferta.',
    placeholder: 'Ya no quiero guardias. Y monté la comunidad de Manfred, 120k devs…',
    send: 'Contárselo',
    sending: 'Guardando…',
    thinking: 'Déjame mirar lo que sé de ti…',
    done: 'Apuntado. Tardo un momento en encajarlo, y si cambia lo que pienso de algo que tengo en el aire, te aviso.',
    failed: 'No se ha guardado. Sigue escrito aquí: inténtalo otra vez.',
    slow: 'Estoy tardando más de la cuenta. Te contesto por Telegram en cuanto lo tenga.',
    another: 'Contarle otra cosa',
  },
  en: {
    kicker: 'Tell me something',
    lead: "Whatever you tell me joins what I know about you, whether or not it is about a job. It does not have to be about anything.",
    placeholder: 'No more on-call. And I ran the Manfred community, 120k devs…',
    send: 'Tell them',
    sending: 'Saving…',
    thinking: 'Let me look at what I know about you…',
    done: "Noted. It takes me a moment to place it, and if it changes what I think of something I'm sitting on, you'll hear from me.",
    failed: 'It did not save. It is still written here: try again.',
    slow: 'This is taking longer than it should. I will answer on Telegram once I have it.',
    another: 'Tell them something else',
  },
} as const

interface TellYourRepProps {
  language: Language
}

/**
 * Volver a por la respuesta hasta que esté, y rendirse a tiempo.
 *
 * Dos minutos: si a los dos minutos no está, algo va mal y quedarse girando
 * es mentir. La respuesta no se pierde —está guardada en su fila— y el Rep
 * la manda por Telegram, que es donde de todas formas vive esto.
 */
async function waitForAnswer(id: string): Promise<string | null> {
  const until = Date.now() + 120_000
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const response = await fetch(`/api/profile/context?id=${encodeURIComponent(id)}`)
    if (!response.ok) return null
    const { answer } = (await response.json()) as { answer: string | null }
    if (answer) return answer
  }
  return null
}

/**
 * La caja que faltaba.
 *
 * Hasta ahora sólo se le podía contar algo al Rep contestando a una pregunta
 * suya, o por Telegram. Pero la pantalla es justo donde alguien acaba de
 * mirar su propio mapa y se da cuenta de que falta algo, y ahí no había
 * dónde escribirlo.
 *
 * Se puede hablar, porque tres cosas dichas son medio minuto y escritas son
 * cinco. Y no confirma con un «hecho» a secas: lo que pasa después —que
 * tarda un momento, y que si mueve algo lo dirá— es información, no cortesía.
 */
export default function TellYourRep({ language }: TellYourRepProps) {
  const words = COPY[language] ?? COPY.es
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'thinking' | 'done'>('idle')
  const [answer, setAnswer] = useState<string | null>(null)
  /** Si lo último que mandó era una pregunta: sin esto, «no hay respuesta» y
      «no hacía falta ninguna» se dirían igual, que es el bug de hoy otra vez. */
  const [asked, setAsked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const written = text.trim()
    if (written.length === 0 || state === 'sending') return

    setState('sending')
    setError(null)
    try {
      const response = await fetch('/api/profile/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: written }),
      })
      if (!response.ok) throw new Error('no')
      const { id, asking } = (await response.json()) as { id: string; asking: boolean }
      setText('')

      setAsked(asking)
      if (!asking) {
        setState('done')
        return
      }

      // Era una pregunta. La respuesta cuesta medio minuto de modelo, así que
      // la petición no se queda colgada: se vuelve a por ella. Lo que se
      // enseña mientras tanto dice lo que está pasando de verdad —«déjame
      // mirar lo que sé de ti»— y no un girador.
      setState('thinking')
      setAnswer(await waitForAnswer(id))
      setState('done')
    } catch {
      setState('idle')
      setError(words.failed)
    }
  }

  if (state === 'thinking') {
    return (
      <section className={styles.box} aria-label={words.kicker}>
        <p className={styles.thinking} role="status">
          {words.thinking}
        </p>
      </section>
    )
  }

  if (state === 'done') {
    return (
      <section className={styles.box} aria-label={words.kicker}>
        <p className={styles.done} role="status">
          {answer ?? (asked ? words.slow : words.done)}
        </p>
        <button
          type="button"
          className={`text-btn ${styles.again}`}
          onClick={() => {
            setAnswer(null)
            setAsked(false)
            setState('idle')
          }}
        >
          {words.another}
        </button>
      </section>
    )
  }

  return (
    <section className={styles.box} aria-label={words.kicker}>
      <p className="kicker">{words.kicker}</p>
      <p className={styles.lead}>{words.lead}</p>

      <form onSubmit={submit}>
        <textarea
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          placeholder={words.placeholder}
          aria-label={words.kicker}
        />
        <div className={styles.actions}>
          {/* Lo dictado entra en la caja, no se manda solo: una transcripción
              que llega al grafo sin que nadie la lea es peor que no entender
              nada. */}
          <VoiceRecorder
            live
            onCapture={(spoken) =>
              setText((current) => (current.trim().length > 0 ? `${current} ${spoken}` : spoken))
            }
          />
          <button className={styles.send} type="submit" disabled={text.trim().length === 0}>
            {state === 'sending' ? words.sending : words.send}
          </button>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  )
}
