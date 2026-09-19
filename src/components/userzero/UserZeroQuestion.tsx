'use client'

import { useState } from 'react'
import styles from '@/app/listening/listening.module.css'

export interface OpenQuestion {
  id: string
  question: string
  reason: string
  company: string | null
  role: string | null
}

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
  onAnswered,
}: {
  question: OpenQuestion
  onAnswered: () => void
}) {
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
        setFailed(body?.error ?? "That didn't go through. Try again.")
        setSending(false)
        return
      }
      onAnswered()
    } catch {
      setFailed('No connection right now. Nothing was sent.')
      setSending(false)
    }
  }

  return (
    <section className={styles.question} aria-label="Something your Rep needs">
      <p className="kicker">One thing before I can say</p>
      <h1 className={styles.questionText}>{question.question}</h1>

      {question.role && question.company && (
        <p className={styles.questionWhy}>
          Something came in for {question.role} at {question.company}, and it turns on this. I
          can&rsquo;t settle it from what I already know about you.
        </p>
      )}

      <textarea
        className={styles.questionInput}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="A line is enough."
        aria-label="Your answer"
        rows={4}
      />

      <div className={styles.answer}>
        <button
          type="button"
          className={styles.answerPrimary}
          disabled={sending || answer.trim().length === 0}
          onClick={() => void send()}
        >
          {sending ? 'Sending…' : 'Send it'}
        </button>
      </div>

      <p className={styles.answerNote} role="status">
        {failed ??
          'A no is a real answer, and a useful one — it saves you hearing about this at all. I haven’t told them anything.'}
      </p>
    </section>
  )
}
