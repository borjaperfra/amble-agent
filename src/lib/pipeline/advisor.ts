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
import { insertAdvice, listOpenAdvice, type AdviceRow } from '../db/advice'
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
import { copyIn } from '@/lib/copy'
import { auditAdvice, renderAdvice, type AdvisorPoint } from '@/domains/advisor/rules'
import { listEvidence } from '../db/repo'
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
    // Con sus ids: son lo unico que el modelo puede citar para que un consejo
    // se guarde, y un id que no ve es un consejo que se descarta.
    lines.push('', 'WHAT IS NOT KNOWN ABOUT THEM YET (cite these ids):')
    for (const uncertainty of open.slice(0, 12)) {
      lines.push(`- [${uncertainty.id}] ${uncertainty.description}`)
    }
  }

  // Y lo que ha visto. Es lo único que el Rep sabe del mercado: estas y
  // ninguna más.
  const decided = listOpportunities(candidateId)
    .map((opportunity) => ({ opportunity, decision: getLatestDecision(opportunity.id) }))
    .filter((item) => item.decision)
    .slice(0, 12)
  if (decided.length > 0) {
    lines.push(
      '',
      'OPPORTUNITIES YOU HAVE READ FOR THEM (all of them, there are no others; cite these ids):',
    )
    for (const { opportunity, decision } of decided) {
      lines.push(
        `- [${opportunity.id}] ${opportunity.role} · ${opportunity.company} → ${decision!.decision}: ${decision!.reason.slice(0, 180)}`,
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

/**
 * Lo que sigue en pie entre los dos, en texto.
 *
 * Va al prompt por dos motivos, y el segundo importa más. Para no repetirse
 * —volver a aconsejar en noviembre lo mismo que en octubre es la forma más
 * rápida de que alguien deje de leerte—. Y para poder referirse a ello: «esto
 * es lo que te dije», que es la diferencia entre un asesor y un oráculo que
 * empieza de cero cada vez.
 */
export function openThreads(candidateId: string): string {
  const open = listOpenAdvice(candidateId, 12)
  if (open.length === 0) return ''
  return open
    .map((row) => {
      const who = row.side === 'rep' ? 'YOU ADVISED' : 'THEY SAID THEY WOULD'
      const about = (JSON.parse(row.uncertainty_ids) as string[]).join(', ')
      return `- [${row.id}] ${who}: ${row.text}${about ? ` (about: ${about})` : ''}`
    })
    .join('\n')
}

/**
 * Guardar lo que merece durar, y sólo si cita algo que existe.
 *
 * El modelo propone qué recordar; aquí se comprueba. Un consejo cuyos ids no
 * corresponden a ninguna incertidumbre ni a ninguna oferta real no se guarda
 * — es la misma regla que impide que una capacidad se sostenga en una
 * evidencia inventada, aplicada a la conversación. Sin esto, la memoria se
 * llena de «sigue así» y deja de valer para nada.
 */
function rememberFromAnswer(
  candidateId: string,
  messageId: string,
  proposed: { side: 'rep' | 'candidate'; text: string; uncertaintyIds: string[]; opportunityIds: string[] }[],
): AdviceRow[] {
  const realUncertainties = new Set(listUncertainties(candidateId).map((item) => item.id))
  const realOpportunities = new Set(listOpportunities(candidateId).map((item) => item.id))

  const kept: AdviceRow[] = []
  for (const item of proposed) {
    const uncertaintyIds = item.uncertaintyIds.filter((id) => realUncertainties.has(id))
    const opportunityIds = item.opportunityIds.filter((id) => realOpportunities.has(id))
    if (uncertaintyIds.length === 0 && opportunityIds.length === 0) continue

    kept.push(
      insertAdvice({
        candidate_id: candidateId,
        inbound_message_id: messageId,
        side: item.side,
        text: item.text,
        uncertainty_ids: uncertaintyIds,
        evidence_ids: [],
        opportunity_ids: opportunityIds,
      }),
    )
  }
  return kept
}

export interface AnsweredQuestion {
  answer: string
  unknowns: string[]
  /** Lo que quedó guardado de esta conversación, ya comprobado. */
  remembered: AdviceRow[]
  /** Lo que sostiene cada cosa dicha, ya comprobado contra el grafo. */
  points: AdvisorPoint[]
  /** Lo que se cayó por no sostenerse. La cuenta es la medida: cero. */
  dropped: number
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
  if (message.answer) {
    return {
      answer: message.answer,
      unknowns: [],
      remembered: [],
      points: JSON.parse(message.answer_sources ?? '[]') as AdvisorPoint[],
      dropped: 0,
    }
  }

  const { data } = await runAnswerCandidateQuestionTask({
    candidateId,
    question: message.text,
    language: readPreferences(candidateId).language ?? 'es',
    profile: profileDigest(candidateId),
    open: openThreads(candidateId),
    history: answerHistory(candidateId, messageId),
  })

  // Lo que no se puede trazar se descarta en vez de ensenarse, y se cuenta.
  // La misma regla que la explicacion de una oferta, y aqui hace mas falta:
  // si el modelo se inventa algo en una decision, las reglas la tumban; en un
  // consejo no hay nada que tumbar, se lee y se cree.
  const audit = auditAdvice(
    { points: data.points, askBack: data.askBack },
    {
      evidenceIds: listEvidence(candidateId).map((item) => item.id),
      uncertaintyIds: listUncertainties(candidateId).map((item) => item.id),
      opportunityIds: listOpportunities(candidateId).map((item) => item.id),
    },
  )

  const answer = renderAdvice(audit, copyIn(readPreferences(candidateId).language).bot.nothingGrounded)

  recordInboundAnswer(messageId, answer, audit.points)
  const remembered = rememberFromAnswer(candidateId, messageId, data.remember)

  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'inbound',
    subject_id: messageId,
    event: 'question_answered_by_rep',
    detail: {
      channel: message.channel,
      chars: answer.length,
      unknowns: data.unknowns,
      points: audit.points.length,
      // Objetivo: cero. Si esto sube, el asesor esta afirmando cosas que no
      // puede sostener y el candidato se estaba creyendo la mitad.
      dropped: audit.dropped.length,
      droppedWhy: audit.dropped.map((item) => item.why),
      // Si esto deja de estar vacio, el Rep esta hablando en el idioma del
      // grafo y no en el suyo, y eso no se ve leyendo una respuesta suelta.
      jargon: audit.plainness.jargon,
      longestSentence: audit.plainness.longestSentence,
      // Cuántas propuso y cuántas citaban algo real. La diferencia es lo que
      // habría acabado siendo memoria de relleno.
      proposed: data.remember.length,
      remembered: remembered.length,
    },
  })

  return {
    answer,
    unknowns: data.unknowns,
    remembered,
    points: audit.points,
    dropped: audit.dropped.length,
  }
}
