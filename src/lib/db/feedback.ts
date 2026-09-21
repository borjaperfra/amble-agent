/**
 * La libreta.
 *
 * Todo lo demás en esta base es lo que Amble sabe de una persona. Esto no:
 * esto es lo que la persona piensa de Amble, escrito desde el móvil en el
 * momento en que se le ocurre y no media hora después delante del portátil,
 * que es cuando ya se le ha olvidado.
 *
 * Deliberadamente tonta. Un texto y una fecha. Sin estado, sin etiquetas,
 * sin prioridad: una idea que hay que clasificar antes de poder apuntarla es
 * una idea que no se apunta. Lo que haya que hacer con ellas se decidirá
 * cuando haya veinte y se vea cómo se agrupan de verdad.
 */

import { getDb } from './db'
import { newId, now } from './repo'

export interface FeedbackNoteRow {
  id: string
  candidate_id: string
  text: string
  created_at: string
}

/** Lo que cabe de una vez. Más largo que esto es una conversación. */
export const MAX_NOTE_LENGTH = 2000

export function insertFeedbackNote(candidateId: string, text: string): FeedbackNoteRow {
  const id = newId('fb')
  getDb()
    .prepare('INSERT INTO feedback_notes (id, candidate_id, text, created_at) VALUES (?, ?, ?, ?)')
    .run(id, candidateId, text.trim().slice(0, MAX_NOTE_LENGTH), now())
  return getFeedbackNote(id) as FeedbackNoteRow
}

export function getFeedbackNote(id: string): FeedbackNoteRow | undefined {
  return getDb().prepare('SELECT * FROM feedback_notes WHERE id = ?').get(id) as unknown as
    | FeedbackNoteRow
    | undefined
}

/** Lo último arriba: lo que acaba de escribir es lo que quiere ver. */
export function listFeedbackNotes(candidateId: string, limit = 200): FeedbackNoteRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM feedback_notes WHERE candidate_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(candidateId, limit) as unknown as FeedbackNoteRow[]
}

/**
 * Borrar una.
 *
 * Existe por lo mismo que existe la caja: si apuntar algo sin pensarlo tiene
 * coste —una línea tonta que se queda ahí para siempre— se piensa antes de
 * apuntar, y entonces ya no se apunta.
 */
export function deleteFeedbackNote(candidateId: string, id: string): boolean {
  // Suya o de nadie, y comprobado en el SQL en vez de en la ruta: hoy solo
  // hay un candidato y por eso mismo esto no se volvería a mirar nunca.
  const result = getDb()
    .prepare('DELETE FROM feedback_notes WHERE id = ? AND candidate_id = ?')
    .run(id, candidateId)
  return Number(result.changes) > 0
}
