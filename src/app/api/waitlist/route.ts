import { NextResponse } from 'next/server'
import {
  joinWaitlist,
  listWaitlist,
  looksLikeEmail,
  waitlistCount,
} from '@/lib/db/waitlist'
import { clearAttempts, recordFailedAttempt, tooManyAttempts } from '@/lib/gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Apuntarse. Es lo único de Amble que puede tocar cualquiera.
 *
 * Todo lo demás vive detrás de la contraseña. Esto no puede, porque el
 * sentido de una lista de espera es que entre gente que aún no tiene nada —
 * así que es la única escritura abierta a internet y se trata como tal.
 *
 * Lo que la protege:
 *
 * - Un tope por origen, el mismo contador que la entrada. Diez en un cuarto
 *   de hora es un dedo torpe; el once es un script.
 * - El correo se normaliza y el índice es único, así que apuntarse cien veces
 *   deja una fila.
 * - **La respuesta es la misma la primera vez y la quinta.** Si dijera «ya
 *   estabas», cualquiera podría averiguar quién está en la lista probando
 *   correos — una fuga de datos de otra gente disfrazada de detalle amable.
 * - Y no devuelve cuántos hay. Ese número es de Borja, no del visitante.
 */
export async function POST(request: Request) {
  const from = `waitlist:${(request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()}`
  if (tooManyAttempts(from)) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Prueba dentro de un rato.' },
      { status: 429 },
    )
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email : ''

  if (!looksLikeEmail(email)) {
    // Un correo mal escrito cuenta para el tope: es el intento número uno de
    // quien esté probando cosas.
    recordFailedAttempt(from)
    return NextResponse.json({ error: 'Eso no parece un correo.' }, { status: 400 })
  }

  joinWaitlist(email, 'landing')
  clearAttempts(from)

  return NextResponse.json({ ok: true }, { status: 201 })
}

/**
 * Y verla, que sí pide contraseña.
 *
 * El proxy sólo deja pasar el POST de esta ruta sin cookie, así que llegar
 * aquí ya significa haber entrado. Son correos de otra gente: si esto fuera
 * público, la lista de espera sería una lista de contactos para cualquiera.
 */
export async function GET() {
  return NextResponse.json({ count: waitlistCount(), entries: listWaitlist() })
}
