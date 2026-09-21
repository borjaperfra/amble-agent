/**
 * Lo que os habéis dicho.
 *
 * El grafo guarda lo que él es: capacidades, evidencias, huecos, y cada
 * afirmación apuntando a una cita literal. Esto guarda otra cosa — el estado
 * de una relación. Qué le aconsejó el Rep, sobre qué hueco, y qué dijo él que
 * iba a hacer.
 *
 * Viven aparte porque son de naturaleza distinta, y mezclarlas se paga caro:
 * un consejo metido en el grafo se convertiría en una afirmación sobre su
 * experiencia, y «deberías tener un caso con números» acabaría leyéndose como
 * si lo tuviera.
 *
 * Lo que **no** es: un histórico de chat que el modelo relee. Esa era la
 * trampa de construir una segunda memoria — dos memorias que se contradicen
 * las gana la que no se puede auditar. Así que aquí se aplica la misma regla
 * que en todo lo demás: cada fila apunta a incertidumbres, evidencias u
 * oportunidades que existen de verdad, y un consejo que no puede citar nada
 * no se guarda. Un consejo que no se apoya en nada es un horóscopo, y los
 * horóscopos no hace falta recordarlos.
 */

import { getDb } from './db'
import { newId, now } from './repo'

/** Quién lo dijo. Las dos mitades de una conversación se guardan igual. */
export type AdviceSide = 'rep' | 'candidate'

export type AdviceStatus = 'open' | 'addressed' | 'dropped'

export interface AdviceRow {
  id: string
  candidate_id: string
  inbound_message_id: string | null
  side: AdviceSide
  text: string
  uncertainty_ids: string
  evidence_ids: string
  opportunity_ids: string
  status: AdviceStatus
  addressed_by: string | null
  created_at: string
  updated_at: string
}

export function insertAdvice(row: {
  candidate_id: string
  inbound_message_id: string | null
  side: AdviceSide
  text: string
  uncertainty_ids: string[]
  evidence_ids: string[]
  opportunity_ids: string[]
}): AdviceRow {
  const id = newId('adv')
  const stamp = now()
  getDb()
    .prepare(
      `INSERT INTO advice
         (id, candidate_id, inbound_message_id, side, text,
          uncertainty_ids, evidence_ids, opportunity_ids, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(
      id,
      row.candidate_id,
      row.inbound_message_id,
      row.side,
      row.text.slice(0, 600),
      JSON.stringify(row.uncertainty_ids),
      JSON.stringify(row.evidence_ids),
      JSON.stringify(row.opportunity_ids),
      stamp,
      stamp,
    )
  return getAdvice(id) as AdviceRow
}

export function getAdvice(id: string): AdviceRow | undefined {
  return getDb().prepare('SELECT * FROM advice WHERE id = ?').get(id) as unknown as
    | AdviceRow
    | undefined
}

/** Lo que sigue en pie, lo más reciente primero. */
export function listOpenAdvice(candidateId: string, limit = 20): AdviceRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM advice WHERE candidate_id = ? AND status = 'open'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(candidateId, limit) as unknown as AdviceRow[]
}

export function listAdvice(candidateId: string, limit = 60): AdviceRow[] {
  return getDb()
    .prepare('SELECT * FROM advice WHERE candidate_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(candidateId, limit) as unknown as AdviceRow[]
}

/**
 * Cerrar lo que ha dejado de estar pendiente.
 *
 * Esto es el pago de toda la tabla. Cuando llega algo que resuelve el hueco
 * sobre el que se dio un consejo, el consejo deja de estar abierto solo — y
 * el Rep puede decir «esto cubre lo que te dije en octubre» en vez de volver
 * a aconsejar lo mismo, que es la forma más rápida de que alguien deje de
 * escuchar.
 *
 * Devuelve lo que cerró, porque quien llama suele querer contarlo.
 */
export function addressAdviceFor(
  candidateId: string,
  uncertaintyIds: string[],
  addressedBy: string,
): AdviceRow[] {
  if (uncertaintyIds.length === 0) return []

  const open = listOpenAdvice(candidateId, 100).filter((row) => {
    const targets = JSON.parse(row.uncertainty_ids) as string[]
    return targets.some((id) => uncertaintyIds.includes(id))
  })

  const stamp = now()
  for (const row of open) {
    getDb()
      .prepare("UPDATE advice SET status = 'addressed', addressed_by = ?, updated_at = ? WHERE id = ?")
      .run(addressedBy, stamp, row.id)
  }
  return open
}

/** Ya no viene a cuento: ni se cumplió ni hace falta seguir esperándolo. */
export function dropAdvice(id: string): void {
  getDb()
    .prepare("UPDATE advice SET status = 'dropped', updated_at = ? WHERE id = ?")
    .run(now(), id)
}
