/**
 * El Rep contestando, que es lo que le faltaba para ser alguien.
 *
 * Hasta hoy el Rep solo hablaba cuando el pipeline producía algo: una
 * interrupción, una pregunta suya. Un mensaje del candidato se clasificaba y
 * se archivaba. Si le preguntabas «¿qué me falta para un Head of Growth en
 * una Serie B?», lo que recibías era «apuntado», porque la rama de contexto
 * de perfil se lo tragaba todo — incluidas las preguntas.
 *
 * Eso es lo que hace que esto se lea como un formulario con conversación
 * encima en vez de como un agente. No lo arregla un modelo mejor: lo arregla
 * distinguir una pregunta de una afirmación y tener algo que decir.
 *
 * Y lo que tiene que decir sale del grafo. El Rep no sabe nada del mercado —
 * ha visto las ofertas que ha visto y ninguna más— así que un consejo suyo
 * solo puede apoyarse en tres cosas: un hueco de lo que sabe de él, un
 * requisito que ha aparecido en lo que le ha llegado, o algo que él dijo. Un
 * consejo que no se apoya en nada es un horóscopo, y de esos ya hay.
 */

import { getInboundMessage, listInboundMessages, recordInboundAnswer } from '../db/inbound'
import {
  getLatestIntent,
  listCapabilities,
  listUncertainties,
  parseJsonArray,
} from '../db/repo'
import {
  getLatestDecision,
  listOpportunities,
  recordAuditEvent,
} from '../db/opportunities'
import { runAnswerCandidateQuestionTask } from '../model/tasks'
import { readPreferences } from './preferences'

/**
 * Si eso era una pregunta.
 *
 * Una heurística, y dicha como tal: un signo de interrogación, o una palabra
 * interrogativa al principio. No acierta siempre —«me pregunto si debería
 * moverme» no la coge— y el coste de fallar está repartido a propósito. Si
 * toma por pregunta lo que no lo era, contesta algo de más. Si no la ve,
 * pasa lo de antes, que es lo que ya había.
 *
 * Lo que no hace es llamar al modelo para decidirlo. Una llamada por cada
 * mensaje, para averiguar si hay que hacer otra llamada, es el diseño que
 * hace que esto cueste el doble sin ser el doble de listo.
 */
const OPENERS =
  /^\s*(qué|que|cuál|cual|cuáles|cuales|cómo|como|cuándo|cuando|cuánto|cuanto|cuánta|cuanta|dónde|donde|quién|quien|por qué|porque|para qué|puedo|puedes|podrías|debería|deberia|debo|merece|tiene sentido|sabes|crees|me recomiendas|recomiéndame|qué opinas|what|which|how|when|where|who|why|should|can|could|do you|does it|is it|are there|would)\b/i

export function looksLikeAQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (trimmed.includes('?') || trimmed.includes('¿')) return true
  return OPENERS.test(trimmed)
}

/**
 * Todo lo que el Rep sabe de él, en texto y ordenado por lo que más pesa.
 *
 * Va entero en el prompt a propósito: lo que no esté aquí, el modelo no lo
 * tiene, y entonces no puede afirmarlo. Es la misma idea que sostiene el
 * resto del pipeline —solo se puede decir lo que se puede citar— aplicada a
 * una conversación.
 */
export function profileDigest(candidateId: string): string {
  const lines: string[] = []

  const capabilities = listCapabilities(candidateId)
  if (capabilities.length > 0) {
    lines.push('CAPABILITIES (assessed from evidence):')
    for (const capability of capabilities) {
      lines.push(`- ${capability.name} [${capability.assessment}] — ${capability.reason.slice(0, 220)}`)
    }
  }

  const intent = getLatestIntent(candidateId)
  if (intent) {
    lines.push('', 'WHAT THEY SAID THEY WANT, IN THEIR WORDS:')
    lines.push(intent.raw_answer.slice(0, 900))
    const listening = parseJsonArray(intent.listening_for)
    if (listening.length > 0) lines.push(`LISTENING FOR: ${listening.join(' · ')}`)
  }

  const preferences = readPreferences(candidateId)
  lines.push(
    '',
    'THEIR CONDITIONS:',
    `- Floor: ${preferences.salaryMin ?? 'not set'} ${preferences.salaryCurrency ?? ''}`.trim(),
    `- Way of working: ${preferences.workMode ?? 'not set'}`,
    `- Based in: ${preferences.location ?? 'not set'}`,
  )

  // Lo que no se sabe de él. Es la mitad más útil para aconsejar: un consejo
  // es casi siempre «esto que no se sabe de ti es lo que te está costando».
  const open = listUncertainties(candidateId, 'OPEN')
  if (open.length > 0) {
    lines.push('', 'WHAT IS NOT KNOWN ABOUT THEM YET:')
    for (const uncertainty of open.slice(0, 12)) {
      lines.push(`- ${uncertainty.description}`)
    }
  }

  // Y lo que ha visto. Es lo único que el Rep sabe del mercado: estas y
  // ninguna más.
  const decided = listOpportunities(candidateId)
    .map((opportunity) => ({ opportunity, decision: getLatestDecision(opportunity.id) }))
    .filter((item) => item.decision)
    .slice(0, 12)
  if (decided.length > 0) {
    lines.push('', 'OPPORTUNITIES YOU HAVE READ FOR THEM (all of them, there are no others):')
    for (const { opportunity, decision } of decided) {
      lines.push(
        `- ${opportunity.role} · ${opportunity.company} → ${decision!.decision}: ${decision!.reason.slice(0, 180)}`,
      )
    }
  }

  return lines.join('\n')
}

/**
 * Lo que ya le dijo antes.
 *
 * Corto y sólo lo contestado: es para no repetirse ni contradecirse, no para
 * que el modelo tenga una transcripción. Lo que él es vive en el grafo y ya
 * va arriba; esto es el estado de la conversación, que es otra cosa.
 */
function answerHistory(candidateId: string, exceptId: string): string {
  return listInboundMessages(candidateId, 20)
    .filter((message) => message.answer && message.id !== exceptId)
    .slice(0, 4)
    .reverse()
    .map((message) => `THEY ASKED: ${message.text.slice(0, 200)}\nYOU SAID: ${message.answer?.slice(0, 400)}`)
    .join('\n\n')
}

export interface AnsweredQuestion {
  answer: string
  unknowns: string[]
}

/**
 * La cola: contestar de verdad, guardarlo, y devolvérselo a quien pregunte.
 *
 * No manda nada por sí mismo. Quién entrega la respuesta lo decide el
 * transporte por el que entró la pregunta — el bot la manda por Telegram, la
 * pantalla la viene a buscar— porque un trabajo que sabe enviar por Telegram
 * es un trabajo que hay que tocar el día que haya WhatsApp.
 */
export async function answerQuestionJob(
  candidateId: string,
  messageId: string,
): Promise<AnsweredQuestion> {
  const message = getInboundMessage(messageId)
  if (!message) throw new Error(`Inbound message ${messageId} is gone.`)

  // Un reintento no vuelve a pagar la respuesta ni le manda otra distinta a
  // la misma pregunta.
  if (message.answer) return { answer: message.answer, unknowns: [] }

  const { data } = await runAnswerCandidateQuestionTask({
    candidateId,
    question: message.text,
    language: readPreferences(candidateId).language ?? 'es',
    profile: profileDigest(candidateId),
    history: answerHistory(candidateId, messageId),
  })

  recordInboundAnswer(messageId, data.answer)
  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'inbound',
    subject_id: messageId,
    event: 'question_answered_by_rep',
    detail: {
      channel: message.channel,
      chars: data.answer.length,
      unknowns: data.unknowns,
    },
  })

  return { answer: data.answer, unknowns: data.unknowns }
}
