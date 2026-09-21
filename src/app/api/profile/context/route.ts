import { NextResponse } from 'next/server'
import { isUserZero } from '@/lib/features'
import { getOrCreateCandidate, newId } from '@/lib/db/repo'
import { claimInboundMessage, getInboundMessage } from '@/lib/db/inbound'
import { looksLikeAQuestion } from '@/lib/pipeline/advisor'
import { recordAuditEvent } from '@/lib/db/opportunities'
import { enqueue } from '@/lib/pipeline/jobs'

export const runtime = 'nodejs'

/** Lo mismo que cabe en un mensaje de Telegram. Más largo es una conversación. */
const MAX_LENGTH = 4000

/**
 * Contarle algo al Rep sin que haya preguntado nada.
 *
 * La regla del 19 —todo lo que llegue de él es contexto del perfil— vivía
 * solo en Telegram. Por la pantalla no había forma: o contestabas a una
 * pregunta abierta, o no había dónde escribir. Y la pantalla es donde está
 * quien acaba de mirar su propio mapa y se da cuenta de que falta algo.
 *
 * No hay nada nuevo detrás de esto. Escribe la misma fila que escribiría un
 * mensaje del bot y encola el mismo trabajo, que es lo que garantiza que lo
 * dicho aquí y lo dicho allí acaben en el grafo de la misma manera — con la
 * misma extracción, la misma procedencia y el mismo guardarraíl contra
 * incorporarlo dos veces.
 */
export async function POST(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text.length === 0) {
    return NextResponse.json({ error: 'Nothing to tell.' }, { status: 400 })
  }
  if (text.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `That is longer than ${MAX_LENGTH} characters.` },
      { status: 400 },
    )
  }

  const candidate = getOrCreateCandidate()

  // Una pregunta se contesta; una afirmación se archiva. Y puede ser las dos
  // cosas —«me he mudado a Lisboa, ¿eso cambia algo?»— así que lo que decide
  // esto es qué se le devuelve, no si entra al perfil: entra igual.
  const asking = looksLikeAQuestion(text)

  // El `external_id` lo pone el servidor y no el navegador: es la clave que
  // impide tratar dos veces el mismo mensaje, y una que venga de fuera es una
  // que alguien puede repetir a propósito.
  const claim = claimInboundMessage({
    candidate_id: candidate.id,
    channel: 'web',
    external_id: newId('web'),
    chat_id: 'web',
    sender: null,
    text,
    outcome: asking ? 'answered_by_rep' : 'noted_as_context',
  })

  recordAuditEvent({
    candidate_id: candidate.id,
    subject_type: 'inbound',
    subject_id: claim.message.id,
    event: 'inbound_message',
    detail: {
      channel: 'web',
      outcome: asking ? 'answered_by_rep' : 'noted_as_context',
      chars: text.length,
      spoken: false,
    },
  })

  enqueue('incorporate_unprompted', candidate.id, { messageId: claim.message.id })
  // Contestar cuesta medio minuto de modelo. En un chat eso se tapa con
  // «escribiendo…»; una petición HTTP colgada medio minuto desde un móvil se
  // muere en el primer túnel, así que aquí la pantalla vuelve a buscarla.
  if (asking) enqueue('answer_question', candidate.id, { messageId: claim.message.id })

  return NextResponse.json({ ok: true, id: claim.message.id, asking }, { status: 201 })
}

/**
 * ¿Ya hay respuesta?
 *
 * La pantalla pregunta por su propio mensaje hasta que la hay. No espera
 * eternamente: quien pregunte tiene que decidir cuándo rendirse, y la
 * respuesta sigue guardada en la fila para cuando vuelva.
 */
export async function GET(request: Request) {
  if (!isUserZero()) {
    return NextResponse.json({ error: 'User Zero mode is disabled.' }, { status: 404 })
  }

  const id = new URL(request.url).searchParams.get('id')?.trim() ?? ''
  const message = id.length > 0 ? getInboundMessage(id) : undefined
  const candidate = getOrCreateCandidate()
  if (!message || message.candidate_id !== candidate.id) {
    return NextResponse.json({ error: 'That message is not here.' }, { status: 404 })
  }

  return NextResponse.json({ answer: message.answer, answeredAt: message.answered_at })
}
