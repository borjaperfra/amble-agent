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

import { createHash, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'amble_session'

/** Un año: es su móvil, y volver a escribirla cada semana es cómo se apunta en una nota. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365

export function gatePassword(): string | null {
  const password = process.env.AMBLE_PASSWORD?.trim()
  return password && password.length > 0 ? password : null
}

/**
 * Lo que va en la cookie.
 *
 * No la contraseña: su hash. Si alguien lee la cookie tiene la sesión de
 * todos modos —eso es inevitable en cualquier sesión— pero no se lleva de
 * regalo una contraseña que probar en otro sitio.
 */
export function sessionToken(password: string): string {
  return createHash('sha256').update(`amble:${password}`).digest('hex')
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
