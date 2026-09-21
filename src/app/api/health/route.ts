import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Lo que mira Railway antes de mandar tráfico a un despliegue nuevo.
 *
 * Dice que el proceso levanta y nada más. No toca la base a propósito: un
 * chequeo que abre SQLite convierte un disco lento en un despliegue caído, y
 * además esta ruta pasa la puerta sin contraseña —no puede contar nada de
 * quien esté dentro.
 */
export function GET() {
  return NextResponse.json({ ok: true })
}
