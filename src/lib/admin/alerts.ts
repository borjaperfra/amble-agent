import { getDb } from '../db/db'
import { now } from '../db/repo'
import { whatsappAccountStatus, zernioConfig } from '../whatsapp/zernio'

// A letter to the owner when something needs looking at: a pass that ran out
// of time, the model failing, Meta saying something new about the WhatsApp
// business. At most one of each kind every few hours: the first says it, the
// health tab says the rest. Without a key it only goes to the log.

const FROM = process.env.AMBLE_EMAIL_FROM ?? 'amble <hola@amble.fyi>'
const TO = process.env.AMBLE_ALERT_TO ?? 'borja@amble.fyi'
const EVERY_MS = 6 * 60 * 60 * 1000

export type AlertKind = 'out_of_time' | 'model_failures' | 'whatsapp_status'

// Model failures worth a letter: over this share of the calls in the window,
// and only with enough calls in it that one failure is not a share.
const FAILURE_WINDOW_MS = 3 * 60 * 60 * 1000
const FAILURE_SHARE = 0.05
const FAILURE_MIN_CALLS = 20

function lastAlert(kind: AlertKind): { sent_at: string | null; value: string | null } | undefined {
  return getDb().prepare('SELECT sent_at, value FROM health_alerts WHERE kind = ?').get(kind) as { sent_at: string | null; value: string | null } | undefined
}

async function sendAlert(kind: AlertKind, subject: string, lines: string[]): Promise<boolean> {
  const last = lastAlert(kind)
  if (last?.sent_at && Date.now() - Date.parse(last.sent_at) < EVERY_MS) return false
  // Counted before it goes: a slow or failed send is never followed by a second one at once.
  getDb()
    .prepare('INSERT INTO health_alerts (kind, sent_at) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET sent_at = excluded.sent_at')
    .run(kind, now())
  const text = [...lines, '', 'amble.fyi/admin?tab=health'].join('\n')
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.info(`[amble] alert (${kind}) to ${TO}: ${subject}\n${text}`)
    return true
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `alert:${kind}:${Math.floor(Date.now() / EVERY_MS)}` },
    body: JSON.stringify({ from: FROM, to: [TO], subject: `[amble] ${subject}`, text }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend refused the alert (${response.status}): ${detail.slice(0, 200)}`)
  }
  return true
}

// At the end of a scheduled pass: what it left for lack of time, and how the
// model has done over the last hours.
export async function checkPassAlerts(pass: { slot: string; outOfTime: number; read: number }): Promise<AlertKind[]> {
  const sent: AlertKind[] = []
  if (pass.outOfTime > 0) {
    const lines = [
      `La pasada ${pass.slot} se quedó sin tiempo: ${pass.outOfTime} ofertas sin leer, ${pass.read} leídas.`,
      'Esperan a la siguiente pasada.',
    ]
    if (await sendAlert('out_of_time', `Pasada sin tiempo (${pass.outOfTime} sin leer)`, lines)) sent.push('out_of_time')
  }
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString()
  const calls = getDb()
    .prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(error LIKE ?), 0) AS limited FROM model_runs WHERE created_at >= ?')
    .get('%HTTP 429%', since) as { calls: number; failed: number; limited: number }
  if (calls.calls >= FAILURE_MIN_CALLS && calls.failed / calls.calls > FAILURE_SHARE) {
    const share = Math.round((calls.failed / calls.calls) * 100)
    const lines = [`En las últimas 3 horas fallaron ${calls.failed} de ${calls.calls} llamadas al modelo (${share} %); ${calls.limited} por límite (429).`]
    if (await sendAlert('model_failures', `El modelo falla (${share} %)`, lines)) sent.push('model_failures')
  }
  return sent
}

// Once a round: what Meta last said about the business, against what was
// seen before. The first reading is only remembered.
export async function checkWhatsAppStatus(): Promise<{ lastEvent: string | null; changed: boolean } | null> {
  const config = zernioConfig()
  if (!config || config.sandbox) return null
  const status = await whatsappAccountStatus(config)
  const seen = lastAlert('whatsapp_status')
  const changed = seen !== undefined && seen.value !== status.lastEvent
  getDb()
    .prepare('INSERT INTO health_alerts (kind, value) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET value = excluded.value')
    .run('whatsapp_status', status.lastEvent)
  if (changed) {
    await sendAlert('whatsapp_status', 'Cambio en la cuenta de WhatsApp', [
      `Meta ha cambiado el estado de la cuenta de WhatsApp: ${seen?.value ?? '(ninguno)'} → ${status.lastEvent ?? '(ninguno)'}.`,
      `Nombre: ${status.displayName ?? '?'} (${status.nameStatus ?? '?'}) · calidad: ${status.qualityRating ?? '?'} · límite: ${status.messagingLimitTier ?? '?'}.`,
    ])
  }
  return { lastEvent: status.lastEvent, changed }
}
