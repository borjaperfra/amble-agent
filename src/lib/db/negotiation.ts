/**
 * La conversación entre los dos agentes, guardada.
 *
 * Tres tablas y ninguna sabe lo que significa nada: eso vive en
 * `domains/negotiation`. Aquí sólo se escribe lo que pasó, en orden.
 *
 * Lo que sí impone esta capa es la costura. `openings` es lo que la empresa
 * sabe y no ha publicado, y está separada de `opportunities` —el mismo puesto
 * leído por el Rep— no por normalizar, sino porque es justo por donde esto se
 * parte en dos despliegues. El día que el agente de la empresa viva en otra
 * máquina, `openings` se va con él y `opportunities` se queda.
 */

import { getDb } from './db'
import { newId, now } from './repo'
import type {
  DisclosableFact,
  DisclosureTier,
  NegotiationState,
  Side,
  TurnKind,
} from '@/domains/negotiation/types'

export interface OpeningRow {
  id: string
  employer: string
  role: string
  posting_text: string
  answers: string
  budget_max: number | null
  currency: string | null
  work_model: string | null
  location: string | null
  created_at: string
}

export interface NegotiationRow {
  id: string
  candidate_id: string
  opening_id: string
  opportunity_id: string
  state: NegotiationState
  disclosure_tier: DisclosureTier
  created_at: string
  updated_at: string
}

export interface TurnRow {
  id: string
  negotiation_id: string
  idx: number
  side: Side
  kind: TurnKind
  text: string
  facts: string
  withheld: string
  needs_human: string | null
  unknown_id: string | null
  created_at: string
}

// ─── La oferta, desde el otro lado ────────────────────────────────────────

export function insertOpening(row: {
  employer: string
  role: string
  posting_text: string
  /** Lo que su agente sabe contestar. Lo que no esté aquí, no lo sabe. */
  answers: Record<string, string>
  budget_max?: number | null
  currency?: string | null
  work_model?: string | null
  location?: string | null
}): OpeningRow {
  const id = newId('open')
  getDb()
    .prepare(
      `INSERT INTO openings
         (id, employer, role, posting_text, answers, budget_max, currency, work_model, location, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.employer,
      row.role,
      row.posting_text,
      JSON.stringify(row.answers),
      row.budget_max ?? null,
      row.currency ?? null,
      row.work_model ?? null,
      row.location ?? null,
      now(),
    )
  return getOpening(id) as OpeningRow
}

export function getOpening(id: string): OpeningRow | undefined {
  return getDb().prepare('SELECT * FROM openings WHERE id = ?').get(id) as unknown as
    | OpeningRow
    | undefined
}

// ─── La conversación ──────────────────────────────────────────────────────

/**
 * Una por par, y sólo una.
 *
 * El índice único lo garantiza: dos conversaciones sobre la misma oferta
 * serían dos versiones de lo que se dijo, y la pregunta «¿qué contaste de
 * mí?» dejaría de tener una respuesta.
 */
export function openNegotiation(row: {
  candidate_id: string
  opening_id: string
  opportunity_id: string
}): NegotiationRow {
  const existing = findNegotiation(row.candidate_id, row.opening_id)
  if (existing) return existing

  const id = newId('neg')
  const stamp = now()
  getDb()
    .prepare(
      `INSERT INTO negotiations
         (id, candidate_id, opening_id, opportunity_id, state, disclosure_tier, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', 'guarded', ?, ?)`,
    )
    .run(id, row.candidate_id, row.opening_id, row.opportunity_id, stamp, stamp)
  return getNegotiation(id) as NegotiationRow
}

export function getNegotiation(id: string): NegotiationRow | undefined {
  return getDb().prepare('SELECT * FROM negotiations WHERE id = ?').get(id) as unknown as
    | NegotiationRow
    | undefined
}

export function findNegotiation(
  candidateId: string,
  openingId: string,
): NegotiationRow | undefined {
  return getDb()
    .prepare('SELECT * FROM negotiations WHERE candidate_id = ? AND opening_id = ?')
    .get(candidateId, openingId) as unknown as NegotiationRow | undefined
}

export function setNegotiationState(id: string, state: NegotiationState): void {
  getDb()
    .prepare('UPDATE negotiations SET state = ?, updated_at = ? WHERE id = ?')
    .run(state, now(), id)
}

/**
 * Subir la escalera.
 *
 * Sólo hacia arriba y sólo él. No hay función para bajarla porque lo contado
 * no se descuenta: una vez dicho su nombre, volver a `guarded` sería teatro.
 */
export function introduce(id: string): void {
  getDb()
    .prepare("UPDATE negotiations SET disclosure_tier = 'introduced', updated_at = ? WHERE id = ?")
    .run(now(), id)
}

// ─── Los turnos ───────────────────────────────────────────────────────────

export function appendTurn(row: {
  negotiation_id: string
  side: Side
  kind: TurnKind
  text: string
  facts?: DisclosableFact[]
  withheld?: { kind: string; why: string }[]
  needs_human?: { who: Side; question: string } | null
  unknown_id?: string | null
}): TurnRow {
  const id = newId('turn')
  const idx =
    ((
      getDb()
        .prepare('SELECT MAX(idx) AS last FROM negotiation_turns WHERE negotiation_id = ?')
        .get(row.negotiation_id) as unknown as { last: number | null }
    ).last ?? -1) + 1

  getDb()
    .prepare(
      `INSERT INTO negotiation_turns
         (id, negotiation_id, idx, side, kind, text, facts, withheld, needs_human, unknown_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.negotiation_id,
      idx,
      row.side,
      row.kind,
      row.text,
      JSON.stringify(row.facts ?? []),
      JSON.stringify(row.withheld ?? []),
      row.needs_human ? JSON.stringify(row.needs_human) : null,
      row.unknown_id ?? null,
      now(),
    )
  return getDb().prepare('SELECT * FROM negotiation_turns WHERE id = ?').get(id) as unknown as TurnRow
}

export function listTurns(negotiationId: string): TurnRow[] {
  return getDb()
    .prepare('SELECT * FROM negotiation_turns WHERE negotiation_id = ? ORDER BY idx ASC')
    .all(negotiationId) as unknown as TurnRow[]
}

/** Los huecos que ya se preguntaron, para no volver a preguntarlos. */
export function askedUnknownIds(negotiationId: string): Set<string> {
  return new Set(
    listTurns(negotiationId)
      .filter((turn) => turn.kind === 'question' && turn.unknown_id)
      .map((turn) => turn.unknown_id as string),
  )
}
