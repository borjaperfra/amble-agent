/**
 * La lista de espera.
 *
 * La única parte de Amble que hablan desconocidos. Todo lo demás de esta base
 * es de una persona concreta y está detrás de una contraseña; esto es un
 * campo abierto a internet, y eso cambia lo que hay que cuidar.
 *
 * Tres decisiones, y las tres son sobre lo mismo:
 *
 * - **Un correo y nada más.** Pedir el puesto, la ciudad o «cuéntanos tu
 *   caso» dobla el formulario y lo único que mejora son nuestras hojas de
 *   cálculo. Quien se apunta a una lista de espera no viene a rellenar nada.
 * - **Apuntarse dos veces no pasa nada y no se nota.** La respuesta es la
 *   misma la primera vez y la quinta. Si cambiara, cualquiera podría
 *   averiguar quién está en la lista probando correos, que es una fuga de
 *   datos de otra gente disfrazada de detalle de interfaz.
 * - **Normalizado antes de guardar.** `Borja@Ejemplo.com ` y
 *   `borja@ejemplo.com` son la misma persona esperando la misma invitación.
 */

import { getDb } from './db'
import { newId, now } from './repo'

export interface WaitlistRow {
  id: string
  email: string
  source: string | null
  created_at: string
}

/**
 * Si eso es un correo.
 *
 * A propósito flojo. Validar correos con una expresión estricta rechaza
 * direcciones perfectamente válidas y raras, y lo que de verdad decide si
 * existe es mandarle algo — que es lo que pasará el día del lanzamiento. Esto
 * sólo para lo que claramente no lo es.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 5 || trimmed.length > 254) return false
  if (/\s/.test(trimmed)) return false
  const at = trimmed.indexOf('@')
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false
  const domain = trimmed.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Apuntar a alguien, o darse cuenta de que ya estaba.
 *
 * Devuelve si era nuevo porque el contador lo necesita, no porque haya que
 * contárselo a quien se apunta.
 */
export function joinWaitlist(email: string, source: string | null): { created: boolean } {
  const normalized = normalizeEmail(email)
  const existing = getDb()
    .prepare('SELECT id FROM waitlist WHERE email = ?')
    .get(normalized) as unknown as { id: string } | undefined
  if (existing) return { created: false }

  getDb()
    .prepare('INSERT INTO waitlist (id, email, source, created_at) VALUES (?, ?, ?, ?)')
    .run(newId('wl'), normalized, source, now())
  return { created: true }
}

export function waitlistCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM waitlist').get() as unknown as { n: number }).n
}

/** Los últimos primero: lo que se quiere ver es quién acaba de llegar. */
export function listWaitlist(limit = 500): WaitlistRow[] {
  return getDb()
    .prepare('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as WaitlistRow[]
}
