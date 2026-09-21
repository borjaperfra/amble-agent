import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { getDb } from '@/lib/db/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cuánto falla el modelo de verdad, aquí.
 *
 * El parte de excepciones sólo habla cuando algo va mal, y eso está bien para
 * una pantalla. Pero para saber si un despliegue está sano hace falta el
 * número también cuando es bueno — si no, «no dice nada» y «no hay datos» se
 * ven igual, que es la misma enfermedad que este parte vino a curar.
 *
 * Existe porque la única medición que teníamos —43 fallos de 255 llamadas, el
 * 17%— salió de un portátil con la cobertura de un tren. No era el sistema, y
 * no lo sabíamos: lo dijo Borja, no el producto.
 *
 * Detrás de la contraseña como todo lo demás: dice qué modelo se usa y contra
 * qué endpoint, y eso no es asunto de quien pase por la URL.
 */
export function GET(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const days = Number(new URL(request.url).searchParams.get('days') ?? '7')
  const window = Number.isFinite(days) && days > 0 && days <= 90 ? Math.round(days) : 7

  const candidate = getOrCreateCandidate()
  const db = getDb()

  const overall = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
              ROUND(AVG(latency_ms) / 1000.0, 1) AS meanSeconds
       FROM model_runs
       WHERE candidate_id = ? AND created_at > datetime('now', ?)`,
    )
    .get(candidate.id, `-${window} days`) as unknown as {
    total: number
    failed: number | null
    meanSeconds: number | null
  }

  const byTask = db
    .prepare(
      `SELECT task,
              COUNT(*) AS total,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
              ROUND(AVG(latency_ms) / 1000.0, 1) AS meanSeconds
       FROM model_runs
       WHERE candidate_id = ? AND created_at > datetime('now', ?)
       GROUP BY task ORDER BY total DESC`,
    )
    .all(candidate.id, `-${window} days`) as unknown as {
    task: string
    total: number
    failed: number | null
    meanSeconds: number | null
  }[]

  const errors = db
    .prepare(
      `SELECT error, COUNT(*) AS n FROM model_runs
       WHERE candidate_id = ? AND ok = 0 AND created_at > datetime('now', ?)
       GROUP BY error ORDER BY n DESC LIMIT 8`,
    )
    .all(candidate.id, `-${window} days`) as unknown as { error: string | null; n: number }[]

  const failed = overall.failed ?? 0
  return NextResponse.json({
    windowDays: window,
    total: overall.total,
    failed,
    failureRate: overall.total > 0 ? Number((failed / overall.total).toFixed(4)) : 0,
    meanSeconds: overall.meanSeconds,
    byTask: byTask.map((row) => ({ ...row, failed: row.failed ?? 0 })),
    errors,
  })
}
