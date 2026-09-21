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

import {
  getInboundMessage,
  listInboundMessages,
  recordInboundAnswer,
  recordInboundProgress,
} from '../db/inbound'
import { insertAdvice, listOpenAdvice, type AdviceRow } from '../db/advice'
import {
  getLatestIntent,
  listCapabilities,
  listUncertainties,
  parseJsonArray,
} from '../db/repo'
import {
  getLatestAssessment,
  getLatestDecision,
  getLatestRubric,
  listOpportunities,
  recordAuditEvent,
} from '../db/opportunities'
import { runAnswerCandidateQuestionTask, runRewordAnswerTask } from '../model/tasks'
import { copyIn } from '@/lib/copy'
import { auditAdvice, renderAdvice, stripIds, type AdvisorPoint } from '@/domains/advisor/rules'
import { listEvidence } from '../db/repo'
import { readPreferences } from './preferences'
import {
  FetchRefused,
  opportunityFromMessage,
  readPastedOpportunity,
  requirementsDigest,
} from './pasted-offer'

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
 * Si lo que ha mandado es una oferta para que la mire.
 *
 * Dos formas, y las dos son las que usa la gente: un enlace suelto, o el
 * anuncio pegado entero. Lo segundo se reconoce por el tamaño y no por las
 * palabras: un anuncio de trabajo son mil caracteres largos, y un mensaje de
 * mil caracteres que no es un anuncio tampoco se pierde nada por leerse como
 * si lo fuera —acaba en el perfil igual—.
 *
 * Deliberadamente no mira si dice «oferta» o «vacante». Eso es adivinar el
 * idioma y el vocabulario de alguien, y falla justo con quien escribe raro.
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i

/** Por debajo de esto no es un anuncio, es una frase con un enlace. */
const PASTED_POSTING_CHARS = 900

export function offerInMessage(text: string): { url: string | null; pasted: boolean } {
  const match = URL_IN_TEXT.exec(text)
  const url = match ? match[0] : null
  const withoutUrl = url ? text.replace(url, ' ').trim() : text
  return { url, pasted: withoutUrl.length >= PASTED_POSTING_CHARS }
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

  // La escala salarial entera va antes que los huecos, y completa: si sólo
  // ve el trozo de la tabla donde falta algo, «lo que más paga» sale mal sin
  // que ningún dato sea falso.
  const pay = paySeen(candidateId)
  if (pay.length > 0) {
    lines.push(
      '',
      'WHAT EVERY POSTING YOU HAVE READ PAYS (all of them, highest first — this is the whole scale):',
      pay,
    )
  }

  const unmet = unmetRequirements(candidateId)
  if (unmet.length > 0) {
    lines.push(
      '',
      'OF THOSE POSTINGS, THE ONES WHERE SOMETHING WAS MISSING (not the best paid — the ones with gaps):',
      unmet,
    )
  }

  return lines.join('\n')
}

/**
 * Lo que paga todo lo que ha leído, de más a menos.
 *
 * Existe por un fallo concreto y sutil. El resumen de requisitos sin cubrir
 * va ordenado por lo que paga y cortado por arriba, así que el modelo veía un
 * trozo de la tabla salarial y decia «lo que mas paga de lo que he leido son
 * 234.000» cuando el maximo de verdad era 258.000 — la oferta de 258.000 no
 * salia en ese trozo porque no le faltaba nada.
 *
 * El numero era real. Lo falso era el superlativo, que es una forma de
 * mentira mas dificil de ver que un dato inventado: nadie la pilla
 * comprobando la cifra.
 *
 * Asi que la escala entera, aparte y completa. Cuesta unas lineas de prompt y
 * es la unica forma de que «lo que mas paga» signifique lo que dice.
 */
export function paySeen(candidateId: string): string {
  const rows: { top: number; line: string }[] = []

  for (const opportunity of listOpportunities(candidateId)) {
    const rubric = getLatestRubric(opportunity.id)
    if (!rubric) continue
    try {
      const compensation = (
        JSON.parse(rubric.rubric) as {
          compensation?: { min?: number | null; max?: number | null; currency?: string | null }
        }
      ).compensation
      const top = compensation?.max ?? compensation?.min ?? null
      if (typeof top !== 'number' || top <= 0) continue
      rows.push({
        top,
        line: `- ${opportunity.role} · ${opportunity.company}: ${(compensation?.min ?? top).toLocaleString('en-GB')}–${top.toLocaleString('en-GB')} ${compensation?.currency ?? ''}`.trim(),
      })
    } catch {
      // Una rúbrica ilegible no aparece en la escala. Mejor faltar que mentir.
    }
  }

  if (rows.length === 0) return ''
  return rows
    .sort((a, b) => b.top - a.top)
    .slice(0, 16)
    .map((row) => row.line)
    .join('\n')
}

/**
 * Lo que le han pedido y no ha podido enseñar, empezando por lo que más paga.
 *
 * Esto ya estaba calculado y no lo leía nadie. Cada vez que se evalúa una
 * oferta, la etapa de match dice requisito por requisito si hay evidencia
 * para sostenerlo, y guarda el veredicto. Treinta ofertas después, eso es un
 * mapa de lo que el mercado que le llega le pide y él no puede demostrar.
 *
 * Es lo que convierte «¿qué mejoro?» en una respuesta con suelo. Sin esto, el
 * Rep sólo sabe lo que ignora de él —los huecos del grafo— y eso contesta a
 * «qué no sabes de mí», que es otra pregunta. Con esto puede contestar a «qué
 * me está costando dinero», que es la que él hace.
 *
 * Ordenado por lo que pagaba la oferta, de más a menos, y con el tope
 * incluido: «esta pedía esto y llegaba a 150.000» es una frase que se puede
 * comprobar y sobre la que se puede decidir. «Deberías mejorar tu analítica»
 * no lo es.
 *
 * Nada de agrupar requisitos parecidos: cada oferta lo escribe a su manera, y
 * juntar «experiencia construyendo sistemas backend» con «perfil técnico»
 * porque se parecen es inventarse un dato que luego se cita como real.
 */
export function unmetRequirements(candidateId: string): string {
  const rows: { pay: number; line: string }[] = []

  for (const opportunity of listOpportunities(candidateId)) {
    const assessment = getLatestAssessment(opportunity.id)
    if (!assessment) continue

    let matches: {
      requirement: string
      importance: string
      verdict: string
      note?: string
    }[]
    try {
      matches = JSON.parse(assessment.evidence_match)
    } catch {
      continue
    }

    const unmet = matches.filter(
      (item) =>
        (item.importance === 'REQUIRED' || item.importance === 'HIGH') &&
        (item.verdict === 'NOT_SUPPORTED' || item.verdict === 'UNKNOWN'),
    )
    if (unmet.length === 0) continue

    let pay = 0
    let paid = 'pay not stated'
    const rubric = getLatestRubric(opportunity.id)
    if (rubric) {
      try {
        const compensation = (JSON.parse(rubric.rubric) as { compensation?: { max?: number | null; min?: number | null; currency?: string | null } }).compensation
        const top = compensation?.max ?? compensation?.min ?? null
        if (typeof top === 'number' && top > 0) {
          pay = top
          paid = `up to ${top.toLocaleString('en-GB')} ${compensation?.currency ?? ''}`.trim()
        }
      } catch {
        // Una rúbrica ilegible no tumba el resumen: la oferta entra sin cifra.
      }
    }

    for (const item of unmet.slice(0, 4)) {
      rows.push({
        pay,
        line: `- "${item.requirement.slice(0, 160)}" [${item.importance}, ${item.verdict}] — asked by ${opportunity.role} · ${opportunity.company} (${paid})`,
      })
    }
  }

  if (rows.length === 0) return ''
  return rows
    .sort((a, b) => b.pay - a.pay)
    .slice(0, 14)
    .map((row) => row.line)
    .join('\n')
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
 * Lo mismo, dicho de otra manera.
 *
 * La pieza que hace que el tono se pueda iterar sin desplegar nada. Los
 * puntos ya están, ya están auditados y ya citan lo que citan; lo único que
 * se rehace son las palabras. Una llamada corta en vez de las cuatro de una
 * respuesta entera, que es lo que permite probar diez veces seguidas.
 *
 * Y el guardarraíl, que es el que lo hace seguro: **si la cuenta de puntos no
 * cuadra, se tira la reescritura entera**. Las citas se quedan con su punto
 * por posición, así que un punto de más sería una afirmación sin fuente
 * colada por la puerta del estilo — y esa puerta es justo la que estamos
 * abriendo aquí.
 */
export async function rewordAnswer(
  candidateId: string,
  messageId: string,
  tone: string,
): Promise<{ answer: string; points: AdvisorPoint[] } | null> {
  const message = getInboundMessage(messageId)
  if (!message?.answer) return null

  let points: AdvisorPoint[]
  try {
    points = JSON.parse(message.answer_sources ?? '[]') as AdvisorPoint[]
  } catch {
    return null
  }
  if (points.length === 0) return null

  const preferences = readPreferences(candidateId)
  const { data } = await runRewordAnswerTask({
    candidateId,
    language: preferences.language ?? 'es',
    tone: tone.trim() || preferences.tone || 'Natural, como hablarías en un chat.',
    points: points.map((point) => point.text),
    askBack: null,
  })

  if (data.points.length !== points.length) return null

  // Las citas no se tocan: viajan con su punto, por posición.
  const reworded: AdvisorPoint[] = points.map((point, index) => ({
    ...point,
    text: stripIds(data.points[index]),
  }))

  const audit = auditAdvice(
    { points: reworded, askBack: data.askBack },
    {
      evidenceIds: listEvidence(candidateId).map((item) => item.id),
      uncertaintyIds: listUncertainties(candidateId).map((item) => item.id),
      opportunityIds: listOpportunities(candidateId).map((item) => item.id),
    },
  )
  if (audit.points.length !== points.length) return null

  const answer = renderAdvice(audit, copyIn(preferences.language).bot.nothingGrounded)
  recordInboundAnswer(messageId, answer, audit.points)
  recordAuditEvent({
    candidate_id: candidateId,
    subject_type: 'inbound',
    subject_id: messageId,
    event: 'answer_reworded',
    detail: { tone: tone.slice(0, 200), jargon: audit.plainness.jargon, longestSentence: audit.plainness.longestSentence },
  })

  return { answer, points: audit.points }
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

  // ¿Trae una oferta para que la mire? Entonces eso es la mitad de la
  // respuesta, y hay que leerla antes de decir nada. Son noventa segundos: el
  // progreso se va escribiendo para que quien espera sepa por dónde va.
  let posting = ''
  const offer = offerInMessage(message.text)
  if (offer.url || offer.pasted) {
    try {
      recordInboundProgress(messageId, offer.url ? 'fetching' : 'reading')
      const opportunity = await opportunityFromMessage(candidateId, message.text, offer.url)
      recordInboundProgress(messageId, 'reading')
      await readPastedOpportunity(opportunity.id)
      recordInboundProgress(messageId, 'comparing')
      posting = requirementsDigest(opportunity)
    } catch (error) {
      // No poder abrir un enlace no puede tumbar la respuesta: se le dice, y
      // se contesta con lo que se sabe de él, que no es poco.
      posting =
        error instanceof FetchRefused
          ? `THEY SENT YOU A LINK AND YOU COULD NOT READ IT: ${error.message} Tell them this, briefly, and offer to read it if they paste the text.`
          : ''
    }
  }

  recordInboundProgress(messageId, 'writing')
  const { data } = await runAnswerCandidateQuestionTask({
    candidateId,
    question: message.text,
    language: readPreferences(candidateId).language ?? 'es',
    tone: readPreferences(candidateId).tone ?? '',
    profile: profileDigest(candidateId),
    posting,
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
