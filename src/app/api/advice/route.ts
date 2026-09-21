import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate } from '@/lib/db/repo'
import { dropAdvice, getAdvice, listOpenAdvice } from '@/lib/db/advice'

export const runtime = 'nodejs'

export async function GET() {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }
  const candidate = getOrCreateCandidate()
  return NextResponse.json({ open: listOpenAdvice(candidate.id) })
}

/**
 * «Esto ya no».
 *
 * Existe porque lo que se cierra solo es lo que se cumple, y un consejo puede
 * dejar de tener sentido sin haberse cumplido nunca — cambió de idea, o el
 * consejo era malo. Sin esta puerta, eso se queda abierto para siempre, entra
 * en cada prompt y el Rep lo repite hasta que deja de leerse.
 *
 * Lo marca como descartado, no como cubierto. Confundir las dos cosas sería
 * contarle que hizo algo que no hizo.
 */
export async function DELETE(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const id = new URL(request.url).searchParams.get('id')?.trim() ?? ''
  const row = id.length > 0 ? getAdvice(id) : undefined
  const candidate = getOrCreateCandidate()
  if (!row || row.candidate_id !== candidate.id) {
    return NextResponse.json({ error: 'That is not here.' }, { status: 404 })
  }

  dropAdvice(id)
  return NextResponse.json({ ok: true })
}
