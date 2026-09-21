/**
 * Lo que se atascó, y nada cuando no se atascó nada.
 *
 * Amble promete que casi nada llegue hasta ti, y de ahí sale un problema que
 * no tiene ningún producto que avise de todo: **el silencio correcto y el
 * silencio roto se ven exactamente igual**. Si no llega nada porque no había
 * nada, bien. Si no llega nada porque el token caducó, porque un tablón
 * cambió su API o porque diez ofertas se quedaron encalladas en una cola,
 * también no llega nada — y se ve igual.
 *
 * Eso pasó de verdad el 21 de septiembre: diez ofertas habían superado la
 * criba y llevaban días sin decidirse. No lo dijo ningún log, ningún aviso y
 * ninguna pantalla; se encontró mirando la base a mano.
 *
 * Esto no es un contador. «He mirado 1.650 ofertas por ti» es la métrica de
 * vanidad que el spec prohíbe en §16, y además miente: no cuesta nada y no
 * dice nada. Esto es lo contrario — solo las excepciones, y cuando no hay
 * ninguna la lista está vacía y la pantalla no enseña nada.
 */

import { getDb } from '../db/db'
import { listOpenQuestions, listUnevaluatedOpportunities } from '../db/opportunities'

/**
 * A partir de cuándo una oferta que pasó la criba lleva demasiado esperando.
 *
 * Los sondeos corren cada seis horas y evalúan diez por pasada, así que una
 * cola sana se vacía sobrada en un día. Dos días es holgura de sobra para no
 * avisar de algo que se iba a resolver solo.
 */
const STALE_OPPORTUNITY_HOURS = 48

/** Una pregunta sin contestar más de una semana ya no la va a contestar. */
const STALE_QUESTION_DAYS = 7

/** Cuánto atrás se miran los fallos: lo de hace un mes ya no es noticia. */
const WINDOW_DAYS = 14

export type ExceptionKind =
  | 'stuck_opportunities'
  | 'failed_jobs'
  | 'source_silent'
  | 'stale_questions'
  | 'near_misses'

export interface Exception {
  kind: ExceptionKind
  /** Una línea, en su idioma, sin jerga de la implementación. */
  summary: string
  /** Lo que hay que mirar, si hay que mirar algo. */
  detail: string | null
  count: number
}

function hoursAgo(iso: string): number {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 0
  return (Date.now() - then) / 3_600_000
}

/**
 * El parte, en el orden en el que importa.
 *
 * Primero lo que le está costando algo ahora mismo, después lo que se ha
 * roto, y al final lo que solo es información sobre sus propios ajustes.
 */
export function listExceptions(candidateId: string, language: 'es' | 'en' = 'es'): Exception[] {
  const es = language === 'es'
  const out: Exception[] = []
  const db = getDb()

  // ── Lo que pasó la criba y sigue sin respuesta ──────────────────────────
  const stuck = listUnevaluatedOpportunities(candidateId).filter(
    (opportunity) => hoursAgo(opportunity.created_at) > STALE_OPPORTUNITY_HOURS,
  )
  if (stuck.length > 0) {
    out.push({
      kind: 'stuck_opportunities',
      count: stuck.length,
      summary: es
        ? `${stuck.length} ${stuck.length === 1 ? 'oferta pasó' : 'ofertas pasaron'} el filtro y ${stuck.length === 1 ? 'sigue' : 'siguen'} sin decidirse.`
        : `${stuck.length} ${stuck.length === 1 ? 'offer' : 'offers'} got through the screen and ${stuck.length === 1 ? 'has' : 'have'} still not been decided.`,
      detail: stuck
        .slice(0, 3)
        .map((opportunity) => `${opportunity.role} · ${opportunity.company}`)
        .join('\n'),
    })
  }

  // ── Trabajos que agotaron los reintentos ────────────────────────────────
  const failed = db
    .prepare(
      `SELECT kind, last_error, COUNT(*) AS n FROM jobs
       WHERE candidate_id = ? AND status = 'failed'
         AND updated_at > datetime('now', ?)
       GROUP BY kind, last_error ORDER BY n DESC LIMIT 5`,
    )
    .all(candidateId, `-${WINDOW_DAYS} days`) as unknown as {
    kind: string
    last_error: string | null
    n: number
  }[]
  const failedTotal = failed.reduce((total, row) => total + row.n, 0)
  if (failedTotal > 0) {
    out.push({
      kind: 'failed_jobs',
      count: failedTotal,
      summary: es
        ? `${failedTotal} ${failedTotal === 1 ? 'trabajo se rindió' : 'trabajos se rindieron'} tras reintentarlo.`
        : `${failedTotal} background ${failedTotal === 1 ? 'job gave' : 'jobs gave'} up after retrying.`,
      detail: failed
        .map((row) => `${row.kind}: ${(row.last_error ?? '—').slice(0, 120)}`)
        .join('\n'),
    })
  }

  // ── Una fuente que lleva callada más de lo que dura su ciclo ────────────
  //
  // No es «no ha traído nada», que es normal y sano. Es que no ha llegado ni
  // a correr: si un tablón cambia su API, el sondeo falla, se reprograma, y
  // desde fuera se ve exactamente igual que un día sin ofertas.
  const silent = db
    .prepare(
      `SELECT subject_id, MAX(created_at) AS last FROM audit_events
       WHERE candidate_id = ? AND subject_type = 'source' AND event = 'source_synced'
       GROUP BY subject_id`,
    )
    .all(candidateId) as unknown as { subject_id: string; last: string }[]
  const quiet = silent.filter((row) => hoursAgo(row.last) > 48)
  if (quiet.length > 0) {
    out.push({
      kind: 'source_silent',
      count: quiet.length,
      summary: es
        ? `${quiet.length} ${quiet.length === 1 ? 'fuente lleva' : 'fuentes llevan'} más de dos días sin llegar a leerse.`
        : `${quiet.length} ${quiet.length === 1 ? 'source has' : 'sources have'} not been read for over two days.`,
      detail: quiet
        .map((row) => `${row.subject_id} · ${Math.round(hoursAgo(row.last) / 24)}d`)
        .join('\n'),
    })
  }

  // ── Preguntas que se hicieron y nadie contestó ──────────────────────────
  const stale = listOpenQuestions(candidateId).filter(
    (question) => hoursAgo(question.created_at) > STALE_QUESTION_DAYS * 24,
  )
  if (stale.length > 0) {
    out.push({
      kind: 'stale_questions',
      count: stale.length,
      summary: es
        ? `${stale.length} ${stale.length === 1 ? 'pregunta lleva' : 'preguntas llevan'} más de una semana esperándote.`
        : `${stale.length} ${stale.length === 1 ? 'question has' : 'questions have'} been waiting on you for over a week.`,
      detail: stale.map((question) => question.question).slice(0, 3).join('\n'),
    })
  }

  // ── Las que se quedaron a un palmo del suelo ────────────────────────────
  //
  // No es un fallo, y por eso va la última. Es lo único que puede decirle que
  // su propio suelo le está costando algo, y sin esto desaparecía gratis y en
  // silencio, que es la forma de no enterarse nunca.
  const near = db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit_events
       WHERE candidate_id = ? AND event = 'opportunity_screened_out'
         AND created_at > datetime('now', ?)
         AND detail LIKE '%"near":true%'`,
    )
    .get(candidateId, `-${WINDOW_DAYS} days`) as unknown as { n: number }
  if (near.n > 0) {
    out.push({
      kind: 'near_misses',
      count: near.n,
      summary: es
        ? `${near.n} ${near.n === 1 ? 'oferta se quedó' : 'ofertas se quedaron'} a menos de un 10% de tu suelo.`
        : `${near.n} ${near.n === 1 ? 'offer came' : 'offers came'} within 10% of your floor.`,
      detail: es
        ? 'No las he leído: caen antes de gastar nada. Si eso te parece mal, el suelo se cambia en «Listening for».'
        : 'I did not read them: they drop before anything is spent. If that seems wrong, the floor lives in "Listening for".',
    })
  }

  return out
}
