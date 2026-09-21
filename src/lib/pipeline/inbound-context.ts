/**
 * Lo que cuenta sin que nadie le pregunte.
 *
 * Hasta ahora el grafo solo crecía cuando alguien preguntaba: una pregunta
 * de la entrevista, una pregunta de una oferta, y la respuesta entraba. Un
 * mensaje suyo sin nada abierto se guardaba en `inbound_messages` y ahí se
 * quedaba — una fila que nadie volvía a leer.
 *
 * Eso convertía al Rep en un formulario con conversación encima. Si le
 * cuentas que te has mudado, que ya no quieres guardias, que montaste una
 * comunidad de 4.000 personas, y no viene a cuento de ninguna pregunta
 * abierta, el Rep te lo agradece y lo olvida. La siguiente oferta vuelve a
 * preguntar lo que acabas de contar, que es exactamente lo que hace que
 * alguien deje de mirar el móvil.
 *
 * La regla, del 19 de septiembre: **todo lo que llegue de él es contexto del
 * perfil**, no solo lo que contesta a una pregunta. Así que esto va por el
 * mismo camino que una respuesta —`incorporateAnswer`, con su procedencia—
 * y la única diferencia vive en la extracción, donde un prompt construido
 * alrededor de una pregunta que no existe se la inventa.
 *
 * Lo que no hace, a propósito: no contesta otra vez. El acuse ya salió por
 * Telegram cuando llegó el mensaje, y si esto acaba cambiando una decisión,
 * quien habla es la interrupción, que es la que tiene algo que decir.
 */

import {
  getInboundMessage,
  markInboundIncorporated,
} from '../db/inbound'
import { listHeldOpportunities, recordAuditEvent } from '../db/opportunities'
import { addressAdviceFor } from '../db/advice'
import { incorporateAnswer } from './interview'
import { enqueue } from './jobs'

/**
 * Cuántas en espera se vuelven a decidir de golpe.
 *
 * Volver a decidir cuesta una llamada por oferta, y un mensaje de dos líneas
 * no puede disparar quince. Las más recientes son las que siguen vivas: una
 * oferta que lleva semanas en espera ya no la va a rescatar nadie.
 */
const MAX_REASSESSED_HOLDS = 5

/**
 * Lo mínimo para gastar en volver a decidir.
 *
 * Extraer es barato y casi todo lo que llega no dice nada del perfil —un
 * gracias, una pregunta suya, «vale». Que se hayan creado claims no basta:
 * lo que mueve una decisión es que algo que no se sabía se sepa, o que una
 * capacidad cambie de nota. Si no pasó ninguna de las dos, lo escrito queda
 * en el grafo y nada más se toca.
 */
export async function incorporateUnpromptedJob(
  candidateId: string,
  messageId: string,
): Promise<void> {
  const message = getInboundMessage(messageId)
  if (!message) throw new Error(`Inbound message ${messageId} is gone.`)

  // El mismo guardarraíl que las preguntas, y por el mismo motivo: un
  // reintento tras un «empty response» dejó dos evidencias por cada frase.
  if (message.incorporated_at) return

  const text = message.text.trim()
  if (text.length === 0) return

  const incorporated = await incorporateAnswer(
    candidateId,
    {
      id: message.id,
      question: '',
      reason: '',
      targetCapabilityIds: [],
      label: 'something they told their Rep',
      unprompted: true,
    },
    text,
  )

  markInboundIncorporated(message.id)

  // Lo que le aconsejo sobre un hueco deja de estar abierto cuando el hueco
  // se cierra. Es el pago de toda la tabla: sin esto, en noviembre le vuelve a
  // aconsejar lo que ya hizo en octubre, que es como se deja de leer a
  // alguien.
  const closed = addressAdviceFor(candidateId, incorporated.resolvedUncertaintyIds, message.id)

  const moved =
    incorporated.resolvedUncertaintyIds.length > 0 ||
    incorporated.reassessedCapabilityIds.length > 0

  const held = moved ? listHeldOpportunities(candidateId).slice(0, MAX_REASSESSED_HOLDS) : []
  for (const { opportunity } of held) {
    enqueue('evaluate_opportunity', candidateId, { opportunityId: opportunity.id, reassess: true })
  }

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'inbound',
    subject_id: message.id,
    event: 'unprompted_context_incorporated',
    detail: {
      channel: message.channel,
      chars: text.length,
      claims: incorporated.claimsCreated,
      evidence: incorporated.evidenceCreated,
      resolvedUncertainties: incorporated.resolvedUncertaintyIds.length,
      reassessedCapabilities: incorporated.reassessedCapabilityIds.length,
      reassessedHolds: held.length,
      adviceClosed: closed.length,
    },
  })
}
