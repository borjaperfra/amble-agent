/**
 * The inbox.
 *
 * Everything else in Amble goes one way: a question leaves, an interruption
 * leaves, and the answer only exists if somebody opens the app. This is the
 * other direction — what they sent back, whatever they sent it from.
 *
 * Kept next to the outbox and apart from `repo.ts` for the same reason:
 * User Zero works and is frozen, and this is new. Nothing in here knows what
 * a message means. It knows one arrived, that it has not been acted on
 * twice, and what happened to it.
 */

import { getDb } from './db'
import { newId, now } from './repo'

/**
 * Por dónde llegó.
 *
 * `web` no es un transporte como Telegram —nadie sondea nada— pero la fila es
 * la misma a propósito: lo que escribe en la pantalla y lo que manda al bot
 * tienen que acabar en el perfil por el mismo camino, con el mismo
 * guardarraíl contra incorporarlo dos veces y la misma traza. Dos caminos
 * para lo mismo son dos comportamientos distintos seis meses después.
 */
export type InboundChannel = 'telegram' | 'web'

/**
 * What became of it.
 *
 * `ignored` is not an error and neither is `nothing_pending`: a person is
 * allowed to write to their Rep when nothing is open, and somebody else's
 * chat is allowed to exist. They are separate outcomes because "your reply
 * went nowhere" has several causes and only one of them is a bug.
 *
 * `noted_as_context` is what used to be `nothing_pending` for words. It is a
 * different thing now and deserves its own name: nothing was open, and what
 * they wrote went into the profile anyway. `nothing_pending` is left for the
 * one case where there really is nothing to do — a yes or a no with nothing
 * waiting for one.
 */
export type InboundOutcome =
  | 'answered_question'
  | 'recorded_response'
  | 'greeted'
  | 'nothing_pending'
  /** Nothing was open, and what they wrote became part of the profile. */
  | 'noted_as_context'
  /** A reply to something that had already been dealt with. */
  | 'already_settled'
  | 'ambiguous'
  | 'ignored'
  | 'failed'

export interface InboundRow {
  id: string
  candidate_id: string
  channel: InboundChannel
  external_id: string
  chat_id: string
  sender: string | null
  text: string
  outcome: InboundOutcome
  about_type: string | null
  about_id: string | null
  detail: string | null
  /** When what they wrote was read into the graph, if it ever was. */
  incorporated_at: string | null
  created_at: string
}

/**
 * Claim the message, or find out somebody already did.
 *
 * Written before it is acted on, and `created: false` is the whole point:
 * Telegram keeps handing an update over until an offset confirms it, so the
 * same answer can arrive twice — after a restart, or after a poll that sent
 * its reply and died before confirming. The second one must land here and
 * stop.
 */
export function claimInboundMessage(row: {
  candidate_id: string
  channel: InboundChannel
  external_id: string
  chat_id: string
  sender: string | null
  text: string
  outcome: InboundOutcome
}): { message: InboundRow; created: boolean } {
  const existing = findInboundMessage(row.channel, row.external_id)
  if (existing) return { message: existing, created: false }

  const id = newId('in')
  getDb()
    .prepare(
      `INSERT INTO inbound_messages
         (id, candidate_id, channel, external_id, chat_id, sender, text, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.candidate_id,
      row.channel,
      row.external_id,
      row.chat_id,
      row.sender,
      row.text,
      row.outcome,
      now(),
    )
  return { message: getInboundMessage(id) as InboundRow, created: true }
}

export function getInboundMessage(id: string): InboundRow | undefined {
  return getDb().prepare('SELECT * FROM inbound_messages WHERE id = ?').get(id) as unknown as
    | InboundRow
    | undefined
}

export function findInboundMessage(
  channel: InboundChannel,
  externalId: string,
): InboundRow | undefined {
  return getDb()
    .prepare('SELECT * FROM inbound_messages WHERE channel = ? AND external_id = ?')
    .get(channel, externalId) as unknown as InboundRow | undefined
}

/**
 * Lo que decía el audio.
 *
 * La fila se escribe antes de transcribir —es lo que evita tratar dos veces
 * el mismo mensaje— así que el texto llega después. Se guarda porque es lo
 * único que queda: del audio no se guarda nada.
 */
export function recordInboundTranscript(id: string, text: string): void {
  getDb().prepare('UPDATE inbound_messages SET text = ? WHERE id = ?').run(text, id)
}

/** What it turned out to be, once it was handled. */
export function settleInboundMessage(
  id: string,
  outcome: InboundOutcome,
  about: { type: string; id: string } | null = null,
  detail: string | null = null,
): void {
  getDb()
    .prepare(
      'UPDATE inbound_messages SET outcome = ?, about_type = ?, about_id = ?, detail = ? WHERE id = ?',
    )
    .run(outcome, about?.type ?? null, about?.id ?? null, detail?.slice(0, 500) ?? null, id)
}

/**
 * Where to carry on reading from.
 *
 * Telegram's cursor is the update id, and ours is whatever we have already
 * written down — not a number held in memory, because the process it was
 * held in is exactly the thing that goes away. Ordered numerically rather
 * than as text: update 10 comes after update 9, and as strings it does not.
 */
export function lastInboundExternalId(channel: InboundChannel): number | null {
  const row = getDb()
    .prepare(
      'SELECT MAX(CAST(external_id AS INTEGER)) AS last FROM inbound_messages WHERE channel = ?',
    )
    .get(channel) as unknown as { last: number | null } | undefined
  return row?.last ?? null
}

/**
 * Read into the graph, once.
 *
 * Same guard as a question's answer, and for the same reason: the job can be
 * handed back after a model call that half-failed, and a second pass over
 * the same sentence leaves two pieces of evidence where somebody said one
 * thing once.
 */
export function markInboundIncorporated(id: string): void {
  getDb().prepare('UPDATE inbound_messages SET incorporated_at = ? WHERE id = ?').run(now(), id)
}

export function listInboundMessages(candidateId: string, limit = 50): InboundRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM inbound_messages WHERE candidate_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(candidateId, limit) as unknown as InboundRow[]
}
