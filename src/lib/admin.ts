/**
 * Todo lo que hace falta saber de Amble, en un sitio.
 *
 * Esto no es una pantalla más del producto: es el sitio donde se mira cuando
 * algo no cuadra, y por eso lo junta todo en una consulta y no en ocho
 * peticiones que se van cargando. Lo que se busca aquí casi siempre es una
 * comparación entre dos cosas que viven en tablas distintas —«se han apuntado
 * treinta y el modelo falla un veinte por ciento»— y eso no se ve si cada
 * bloque llega por su cuenta.
 *
 * La regla que lo mantiene útil: **sólo sale lo que existe de verdad**. Nada
 * de tarjetas con un cero esperando a que algún día haya algo, ni gráficas de
 * una serie de un punto. Un panel lleno de ceros es un panel que se deja de
 * mirar, y entonces tampoco se mira el día que el número importa.
 */

import { getDb } from './db/db'
import { listEvaluations, listModelRuns, type EvaluationRow } from './db/repo'
import { listWaitlist, waitlistCount, type WaitlistRow } from './db/waitlist'
import { listFeedbackNotes, type FeedbackNoteRow } from './db/feedback'
import { listAdvice, type AdviceRow } from './db/advice'
import { listInboundMessages, type InboundRow } from './db/inbound'
import { getLatestDecision, listOpportunities } from './db/opportunities'
import { listExceptions, type Exception } from './pipeline/exceptions'
import { queueStatus } from './pipeline/jobs'
import { readPreferences } from './pipeline/preferences'

export interface TaskHealth {
  task: string
  version: string
  runs: number
  failed: number
  meanSeconds: number
  /** Lo que más falló, para no tener que ir a buscarlo. */
  worstError: string | null
}

export interface PipelineCounts {
  total: number
  byStatus: Record<string, number>
  byProvenance: Record<string, number>
  byDecision: Record<string, number>
}

export interface AdminView {
  waitlist: { count: number; entries: WaitlistRow[]; today: number }
  notes: FeedbackNoteRow[]
  /** Lo que marcó como que no sonaba bien, agrupado por motivo. */
  verdicts: { verdict: string; count: number; comments: string[] }[]
  evaluations: EvaluationRow[]
  /** Cuántas veces pidió que se dijera de otra manera, y con qué tono. */
  rewordings: { at: string; tone: string }[]
  model: { runs: number; failed: number; rate: number; byTask: TaskHealth[] }
  pipeline: PipelineCounts
  exceptions: Exception[]
  queue: { busy: boolean; running: string | null; kinds: string[] }
  conversation: { messages: number; answered: number; advice: number; openAdvice: number }
  tone: string | null
}

function tally<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    out[value] = (out[value] ?? 0) + 1
  }
  return out
}

/**
 * La salud del modelo, por tarea **y por versión**.
 *
 * Por versión porque es lo único que convierte «el tono no me gusta» en algo
 * accionable: las tareas están versionadas precisamente para poder decir que
 * la v5 falla donde la v4 no, y agregar las dos juntas tira esa información
 * al suelo justo cuando hace falta.
 */
function modelHealth(days: number): { runs: number; failed: number; rate: number; byTask: TaskHealth[] } {
  const rows = getDb()
    .prepare(
      `SELECT task, task_version AS version,
              COUNT(*) AS runs,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
              ROUND(AVG(latency_ms) / 1000.0, 1) AS meanSeconds
       FROM model_runs
       WHERE created_at > datetime('now', ?)
       GROUP BY task, task_version
       ORDER BY runs DESC`,
    )
    .all(`-${days} days`) as unknown as {
    task: string
    version: string
    runs: number
    failed: number | null
    meanSeconds: number | null
  }[]

  const byTask: TaskHealth[] = rows.map((row) => {
    const worst = getDb()
      .prepare(
        `SELECT error FROM model_runs
         WHERE task = ? AND task_version = ? AND ok = 0 AND created_at > datetime('now', ?)
         GROUP BY error ORDER BY COUNT(*) DESC LIMIT 1`,
      )
      .get(row.task, row.version, `-${days} days`) as unknown as { error: string | null } | undefined

    return {
      task: row.task,
      version: row.version,
      runs: row.runs,
      failed: row.failed ?? 0,
      meanSeconds: row.meanSeconds ?? 0,
      worstError: worst?.error ?? null,
    }
  })

  const runs = byTask.reduce((total, row) => total + row.runs, 0)
  const failed = byTask.reduce((total, row) => total + row.failed, 0)
  return { runs, failed, rate: runs > 0 ? failed / runs : 0, byTask }
}

export function adminView(candidateId: string, days = 7): AdminView {
  const db = getDb()

  const entries = listWaitlist(200)
  const today = entries.filter(
    (row) => row.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length

  // Lo que marcó como que no sonaba bien, agrupado. Agrupado y no en lista
  // porque un motivo suelto es una anécdota y ocho del mismo son un problema.
  const evaluations = listEvaluations(candidateId)
  const grouped = new Map<string, { count: number; comments: string[] }>()
  for (const evaluation of evaluations) {
    const bucket = grouped.get(evaluation.verdict) ?? { count: 0, comments: [] }
    bucket.count += 1
    if (evaluation.comment) bucket.comments.push(evaluation.comment)
    grouped.set(evaluation.verdict, bucket)
  }

  const rewordings = (
    db
      .prepare(
        `SELECT created_at, detail FROM audit_events
         WHERE event = 'answer_reworded' ORDER BY created_at DESC LIMIT 30`,
      )
      .all() as unknown as { created_at: string; detail: string | null }[]
  ).map((row) => {
    let tone = ''
    try {
      tone = ((JSON.parse(row.detail ?? '{}') as { tone?: string }).tone ?? '').slice(0, 160)
    } catch {
      tone = ''
    }
    return { at: row.created_at, tone }
  })

  const opportunities = listOpportunities(candidateId)
  const decisions = opportunities
    .map((opportunity) => getLatestDecision(opportunity.id)?.decision ?? null)
    .filter((value): value is string => Boolean(value))

  const inbound: InboundRow[] = listInboundMessages(candidateId, 200)
  const advice: AdviceRow[] = listAdvice(candidateId, 200)
  const status = queueStatus(candidateId)

  return {
    waitlist: { count: waitlistCount(), entries, today },
    notes: listFeedbackNotes(candidateId, 100),
    verdicts: [...grouped.entries()]
      .map(([verdict, bucket]) => ({ verdict, ...bucket }))
      .sort((a, b) => b.count - a.count),
    evaluations,
    rewordings,
    model: modelHealth(days),
    pipeline: {
      total: opportunities.length,
      byStatus: tally(opportunities, (row) => row.status),
      byProvenance: tally(opportunities, (row) => row.provenance),
      byDecision: tally(decisions, (value) => value),
    },
    exceptions: listExceptions(candidateId, readPreferences(candidateId).language === 'en' ? 'en' : 'es'),
    queue: { busy: status.busy, running: status.running, kinds: status.kinds },
    conversation: {
      messages: inbound.length,
      answered: inbound.filter((row) => row.answer).length,
      advice: advice.length,
      openAdvice: advice.filter((row) => row.status === 'open').length,
    },
    tone: readPreferences(candidateId).tone,
  }
}

/** Lo que hace falta para escribirles: los correos, sin adornos. */
export function waitlistEmails(): string[] {
  return listWaitlist(1000).map((row) => row.email)
}

/** Usado sólo por los tipos del cliente. */
export type { WaitlistRow, FeedbackNoteRow, EvaluationRow, Exception }
export { listModelRuns }
