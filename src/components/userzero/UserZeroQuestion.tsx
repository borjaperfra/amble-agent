'use client'

import { useState } from 'react'
import styles from '@/app/listening/listening.module.css'
import { DEFAULT_LANGUAGE, type Language } from '@/lib/copy'

export interface OpenQuestion {
  id: string
  question: string
  reason: string
  company: string | null
  role: string | null
}

/**
 * Las palabras de esta pantalla, en los dos idiomas.
 *
 * Viven aquí y no en el diccionario del Rep porque son de la pantalla: el
 * diccionario de `lib/copy` es lo que sale por el mensaje, y mezclar las dos
 * cosas obliga a leer dos ficheros para cambiar un botón.
 */
const WORDS = {
  es: {
    aria: 'Algo que necesita tu Rep',
    kicker: 'Una cosa antes de decirte nada',
    why: (role: string, company: string) =>
      `Ha entrado algo para ${role} en ${company} y depende de esto. No lo puedo resolver con lo que ya sé de ti.`,
    placeholder: 'Con una línea vale.',
    answerAria: 'Tu respuesta',
    send: 'Enviar',
    sending: 'Enviando…',
    note: 'Un no también es respuesta, y de las útiles: te ahorra oír hablar de esto. No les he dicho nada.',
    failed: 'No ha salido. Prueba otra vez.',
    offline: 'Ahora mismo no hay conexión. No se ha enviado nada.',
  },
  en: {
    aria: 'Something your Rep needs',
    kicker: 'One thing before I can say',
    why: (role: string, company: string) =>
      `Something came in for ${role} at ${company}, and it turns on this. I can't settle it from what I already know about you.`,
    placeholder: 'A line is enough.',
    answerAria: 'Your answer',
    send: 'Send it',
    sending: 'Sending…',
    note: "A no is a real answer, and a useful one — it saves you hearing about this at all. I haven't told them anything.",
    failed: "That didn't go through. Try again.",
    offline: 'No connection right now. Nothing was sent.',
  },
} as const

/**
 * The smaller of the two things the Rep ever puts in front of somebody.
 *
 * An interruption says "this is worth your evening". This says "one thing
 * before I can tell you whether it is", and it has to look like the smaller
 * ask or the second one nobody opens. So: no facts block, no evidence, no
 * buttons to weigh — a question, why it is being asked, and a box.
 *
 * What it must not do is imply an answer. "Have you run a developer
 * community?" with a hopeful tone is a leading question, and an answer given
 * to please the Rep is evidence of nothing. Hence the line about no being a
 * real answer: it is, and it saves them the interruption.
 */
export default function UserZeroQuestion({
  question,
  language = DEFAULT_LANGUAGE,
  onAnswered,
}: {
  question: OpenQuestion
  language?: Language
  onAnswered: () => void
}) {
  const words = WORDS[language] ?? WORDS[DEFAULT_LANGUAGE]
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  async function send() {
    const text = answer.trim()
    if (text.length === 0 || sending) return
    setSending(true)
    setFailed(null)
    try {
      const response = await fetch('/api/opportunities/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, answer: text }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setFailed(body?.error ?? words.failed)
        setSending(false)
        return
      }
      onAnswered()
    } catch {
      setFailed(words.offline)
      setSending(false)
    }
  }

  return (
    <section className={styles.question} aria-label={words.aria}>
      <p className="kicker">{words.kicker}</p>
      <h1 className={styles.questionText}>{question.question}</h1>

      {question.role && question.company && (
        <p className={styles.questionWhy}>{words.why(question.role, question.company)}</p>
      )}

      <textarea
        className={styles.questionInput}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder={words.placeholder}
        aria-label={words.answerAria}
        rows={4}
      />

      <div className={styles.answer}>
        <button
          type="button"
          className={styles.answerPrimary}
          disabled={sending || answer.trim().length === 0}
          onClick={() => void send()}
        >
          {sending ? words.sending : words.send}
        </button>
      </div>

      <p className={styles.answerNote} role="status">
        {failed ?? words.note}
      </p>
    </section>
  )
}
