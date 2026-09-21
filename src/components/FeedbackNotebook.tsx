'use client'

import { useState } from 'react'
import Header from './Header'
import styles from './FeedbackNotebook.module.css'
import type { FeedbackNoteRow } from '@/lib/db/feedback'

interface FeedbackNotebookProps {
  initialNotes: FeedbackNoteRow[]
}

/**
 * Escribir y leer. Nada más.
 *
 * La caja está arriba y enfocable de un toque porque el 90% de las veces se
 * entra aquí a soltar una frase y salir. La lista está debajo, y está para
 * que se vea que lo de ayer sigue ahí — que es lo único que hace que mañana
 * se vuelva a escribir.
 *
 * Se guarda en optimista: la nota aparece en la lista antes de que el
 * servidor conteste, y si falla vuelve a la caja con lo que había escrito.
 * Escribiendo desde el móvil en el metro, esperar a un 201 para ver que la
 * frase existe es la diferencia entre usarlo y no usarlo.
 */
export default function FeedbackNotebook({ initialNotes }: FeedbackNotebookProps) {
  const [notes, setNotes] = useState(initialNotes)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const written = text.trim()
    if (written.length === 0 || saving) return

    setSaving(true)
    setError(null)
    setText('')

    // Una nota de mentira mientras va: misma forma que la de verdad, para
    // que la lista no salte cuando llegue la buena.
    const pending: FeedbackNoteRow = {
      id: `pending_${Date.now()}`,
      candidate_id: '',
      text: written,
      created_at: new Date().toISOString(),
    }
    setNotes((current) => [pending, ...current])

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: written }),
      })
      if (!response.ok) throw new Error('No se ha guardado.')
      const { note } = (await response.json()) as { note: FeedbackNoteRow }
      setNotes((current) => current.map((item) => (item.id === pending.id ? note : item)))
    } catch {
      setNotes((current) => current.filter((item) => item.id !== pending.id))
      setText(written)
      setError('No se ha guardado. Sigue escrito aquí: inténtalo otra vez.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    const previous = notes
    setNotes((current) => current.filter((item) => item.id !== id))
    try {
      const response = await fetch(`/api/feedback?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('No se ha borrado.')
    } catch {
      setNotes(previous)
      setError('No se ha podido borrar.')
    }
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <h1 className={styles.title}>Ideas</h1>
        <p className={styles.lead}>
          Lo que se te ocurra sobre Amble, según se te ocurra. No hay que ordenarlo ni
          etiquetarlo: para eso ya habrá tiempo.
        </p>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.label} htmlFor="note">
            Qué se te ha ocurrido
          </label>
          <textarea
            id="note"
            className={styles.input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            placeholder="El onboarding debería preguntar la escala una sola vez…"
            autoComplete="off"
          />
          <div className={styles.actions}>
            <button className={styles.submit} type="submit" disabled={text.trim().length === 0}>
              {saving ? 'Apuntando…' : 'Apuntar'}
            </button>
          </div>
          {error ? (
            <p className={styles.error} role="status">
              {error}
            </p>
          ) : null}
        </form>

        {notes.length === 0 ? (
          <p className={styles.empty}>Todavía no hay nada. La primera que se te ocurra.</p>
        ) : (
          <ol className={styles.list}>
            {groupByDay(notes).map((group) => (
              <li key={group.day} className={styles.group}>
                <h2 className={styles.day}>{group.day}</h2>
                <ul className={styles.notes}>
                  {group.notes.map((note) => (
                    <li key={note.id} className={styles.note}>
                      <p className={styles.noteText}>{note.text}</p>
                      <div className={styles.noteFoot}>
                        <time className={styles.time} dateTime={note.created_at}>
                          {timeOf(note.created_at)}
                        </time>
                        <button
                          className={styles.remove}
                          type="button"
                          onClick={() => remove(note.id)}
                        >
                          Borrar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  )
}

/**
 * Por días, y el día en palabras.
 *
 * «hoy» y «ayer» y luego la fecha: una lista de ideas no se lee por fecha
 * exacta, se lee por «lo de esta mañana» y «lo de la semana pasada».
 */
function groupByDay(notes: FeedbackNoteRow[]): { day: string; notes: FeedbackNoteRow[] }[] {
  const groups: { day: string; notes: FeedbackNoteRow[] }[] = []
  for (const note of notes) {
    const day = dayOf(note.created_at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.notes.push(note)
    else groups.push({ day, notes: [note] })
  }
  return groups
}

function dayOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'sin fecha'

  const midnight = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((midnight(new Date()) - midnight(date)) / 86_400_000)

  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
}

function timeOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
