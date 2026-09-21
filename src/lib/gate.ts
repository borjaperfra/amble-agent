/**
 * La puerta.
 *
 * Amble no tiene usuarios: tiene un candidato, y dentro están su CV, su
 * grafo y las ofertas que le han llegado. En el portátil eso no es un
 * problema porque el portátil es suyo. En una URL pública sí lo es, y la URL
 * larga y difícil de adivinar no es un secreto: viaja en el historial, en el
 * portapapeles y en cualquier cosa que mire el tráfico.
 *
 * Así que una contraseña, una sola, la suya. No es un sistema de cuentas y
 * no pretende serlo — el día que haya dos personas esto se tira y se hace
 * bien. Lo que hace hoy es que el enlace por sí solo no valga.
 *
 * Sin `AMBLE_PASSWORD` no hay puerta: en local se sigue entrando como
 * siempre, y montar el despliegue no puede costar una contraseña cada vez
 * que se arranca el dev server.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'amble_session'

/** Un año: es su móvil, y volver a escribirla cada semana es cómo se apunta en una nota. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365

export function gatePassword(): string | null {
  const password = process.env.AMBLE_PASSWORD?.trim()
  return password && password.length > 0 ? password : null
}

/**
 * La sal, generada una vez y guardada en el disco que sobrevive.
 *
 * Sin ella el token de la cookie era `sha256("amble:" + contraseña)`: un
 * valor que cualquiera puede calcular offline probando contraseñas, sin
 * hablar con el servidor y sin que nadie se entere. Con una sal de treinta y
 * dos bytes que sólo existe en este volumen, ese ataque necesita primero el
 * fichero — y quien tenga el fichero ya está dentro.
 *
 * Vive junto a la base y no en una variable de entorno a propósito: así no
 * hay que acordarse de ponerla, y un despliegue nuevo contra el mismo volumen
 * no tira la sesión del móvil.
 *
 * Se escribe con `wx`, que falla si el fichero ya existe, y después se vuelve
 * a leer. Eso importa: `proxy.ts` y la ruta de entrada pueden evaluarse en
 * bundles distintos y pedir la sal a la vez en el primer arranque. Sin esto,
 * uno la genera, el otro la genera distinta, la cookie que firma el login no
 * la valida la puerta, y el resultado es un bucle de redirecciones que no se
 * arregla borrando cookies.
 */
let cachedSalt: string | null = null

function sessionSalt(): string {
  if (cachedSalt) return cachedSalt

  const directory = process.env.AMBLE_DATA_DIR?.trim()
    ? path.resolve(process.env.AMBLE_DATA_DIR.trim())
    : path.join(process.cwd(), '.amble-data')
  const file = path.join(directory, 'session-salt')

  const read = (): string | null => {
    try {
      const value = fs.readFileSync(file, 'utf8').trim()
      return value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  const existing = read()
  if (existing) {
    cachedSalt = existing
    return existing
  }

  const candidate = randomBytes(32).toString('hex')
  try {
    fs.mkdirSync(directory, { recursive: true })
    // Falla si otro llegó primero, y entonces gana el suyo.
    fs.writeFileSync(file, candidate, { flag: 'wx', mode: 0o600 })
  } catch {
    // O existía ya, o el disco es de sólo lectura. La relectura lo distingue.
  }

  cachedSalt = read() ?? candidate
  return cachedSalt
}

/**
 * Lo que va en la cookie.
 *
 * No la contraseña: un hash suyo con la sal de esta instalación. Si alguien
 * lee la cookie tiene la sesión de todos modos —eso es inevitable en
 * cualquier sesión— pero no se lleva de regalo nada que probar en otro sitio.
 */
export function sessionToken(password: string): string {
  return createHash('sha256').update(`amble:${sessionSalt()}:${password}`).digest('hex')
}

// ─── Cuántas veces se puede fallar ────────────────────────────────────────

/**
 * Un contador por origen, en memoria.
 *
 * En memoria porque hay una réplica y sólo una —la base es un fichero y la
 * cola vive dentro del proceso— así que un mapa aquí ve todos los intentos
 * que existen. El día que haya dos, esto hay que moverlo, y por eso está
 * escrito aquí y no repartido por la ruta.
 *
 * Diez intentos por cuarto de hora. Un dedo torpe en el móvil no llega a
 * diez; un script llega a diez en un segundo.
 */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60_000

const attempts = new Map<string, { count: number; until: number }>()

export function tooManyAttempts(from: string): boolean {
  const record = attempts.get(from)
  if (!record) return false
  if (Date.now() > record.until) {
    attempts.delete(from)
    return false
  }
  return record.count >= MAX_ATTEMPTS
}

export function recordFailedAttempt(from: string): void {
  const now = Date.now()
  const record = attempts.get(from)
  if (!record || now > record.until) {
    attempts.set(from, { count: 1, until: now + WINDOW_MS })
    return
  }
  record.count += 1
}

/** Acertar limpia la cuenta: quien entra no estaba atacando. */
export function clearAttempts(from: string): void {
  attempts.delete(from)
}

/** Comparación en tiempo constante: es barata y la alternativa se mide. */
export function tokenMatches(candidate: string | undefined, password: string): boolean {
  if (!candidate) return false
  const expected = Buffer.from(sessionToken(password), 'utf8')
  const given = Buffer.from(candidate, 'utf8')
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

export function passwordMatches(given: string, password: string): boolean {
  const expected = Buffer.from(sessionToken(password), 'utf8')
  const candidate = Buffer.from(sessionToken(given), 'utf8')
  return timingSafeEqual(expected, candidate)
}
