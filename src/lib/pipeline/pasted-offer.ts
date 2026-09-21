/**
 * «Mira esta, ¿qué me falta para aplicar?»
 *
 * Es la pregunta que la gente hace de verdad, y hasta ahora no había forma de
 * hacerla: Amble sólo miraba ofertas que había encontrado él. Esto invierte la
 * dirección — la oferta la trae el candidato, y lo que se le devuelve no es
 * «te interrumpo o no» (ya la está mirando, la decisión de mirarla ya la tomó)
 * sino qué pide y qué de eso puede demostrar.
 *
 * Y no hay tubería nueva. La oferta entra por el mismo sitio que las de
 * Manfred, se evalúa con las mismas cuatro etapas y se guarda en las mismas
 * tablas. Lo único nuevo es la puerta y el marco de la respuesta. Una segunda
 * tubería para «ofertas que me pasa él» sería la forma de que dentro de tres
 * meses las dos decidieran distinto sobre el mismo anuncio.
 */

import {
  findOpportunityBySourceRef,
  getLatestAssessment,
  getOpportunity,
  getLatestRubric,
  insertOpportunity,
  recordAuditEvent,
  type OpportunityRow,
} from '../db/opportunities'
import { fetchPosting, FetchRefused } from '../sources/pasted'
import { evaluateOpportunity } from './opportunities'

export { FetchRefused }

/**
 * Traerla y guardarla, o encontrar la que ya estaba.
 *
 * El `source_ref` lleva el enlace, así que mandar dos veces la misma no crea
 * dos ofertas ni paga dos evaluaciones. Mandar el texto pegado sí crea una
 * nueva cada vez, y está bien: dos textos pegados nunca son idénticos y no
 * hay nada estable con lo que reconocerlos.
 */
export async function opportunityFromMessage(
  candidateId: string,
  text: string,
  url: string | null,
): Promise<OpportunityRow> {
  if (url) {
    const known = findOpportunityBySourceRef(candidateId, `pasted:${url}`)
    if (known) return known

    const posting = await fetchPosting(url)
    return insertOpportunity({
      candidate_id: candidateId,
      // Todavía no sabemos de quién es ni de qué: lo dirá la rúbrica leyendo
      // el anuncio, y ponerlo aquí a ojo sería inventárselo.
      company: 'Sin identificar',
      role: 'Sin identificar',
      url: posting.url,
      raw_text: posting.text,
      provenance: 'pasted',
      source_ref: `pasted:${posting.url}`,
      status: 'received',
    })
  }

  return insertOpportunity({
    candidate_id: candidateId,
    company: 'Sin identificar',
    role: 'Sin identificar',
    url: null,
    raw_text: text,
    provenance: 'pasted',
    status: 'received',
  })
}

/**
 * Lo que pide, y qué de eso puede enseñar.
 *
 * Sale de la etapa de match, que es la que ya compara requisito por requisito
 * contra su grafo y deja dicho con qué evidencia sostiene cada uno. Aquí no se
 * vuelve a juzgar nada: se ordena para que se lea por lo que importa —lo que
 * no puede demostrar primero, porque es lo que ha venido a preguntar— y se le
 * entrega al asesor para que lo diga en su idioma.
 */
export function requirementsDigest(opportunity: OpportunityRow): string {
  const assessment = getLatestAssessment(opportunity.id)
  const rubric = getLatestRubric(opportunity.id)
  if (!assessment) return ''

  const lines: string[] = [
    `THE POSTING THEY SENT YOU: ${opportunity.role} · ${opportunity.company}` +
      (opportunity.url ? ` (${opportunity.url})` : ''),
    `Its id, to cite it: ${opportunity.id}`,
  ]

  if (rubric) {
    try {
      const parsed = JSON.parse(rubric.rubric) as {
        compensation?: { min?: number | null; max?: number | null; currency?: string | null; stated?: string | null }
        workModel?: string | null
        location?: string | null
        companyStage?: string | null
      }
      const pay = parsed.compensation
      lines.push(
        `Pay: ${
          pay?.min || pay?.max
            ? `${pay.min ?? '?'}–${pay.max ?? '?'} ${pay.currency ?? ''}`.trim()
            : (pay?.stated ?? 'not stated')
        } · Way of working: ${parsed.workModel ?? 'not stated'} · Where: ${parsed.location ?? 'not stated'} · Stage: ${parsed.companyStage ?? 'not stated'}`,
      )
    } catch {
      // Una rúbrica ilegible no vale una respuesta menos: lo que importa son
      // los requisitos, y esos vienen del match.
    }
  }

  let matches: {
    requirement: string
    importance: string
    verdict: string
    evidenceIds: string[]
    note: string
  }[]
  try {
    matches = JSON.parse(assessment.evidence_match)
  } catch {
    return lines.join('\n')
  }

  // Lo que no puede demostrar primero: es lo que ha venido a preguntar.
  const order = ['NOT_SUPPORTED', 'UNKNOWN', 'PARTIALLY_SUPPORTED', 'SUPPORTED']
  const weight = ['REQUIRED', 'HIGH', 'MEDIUM', 'LOW']
  const sorted = [...matches].sort(
    (a, b) =>
      order.indexOf(a.verdict) - order.indexOf(b.verdict) ||
      weight.indexOf(a.importance) - weight.indexOf(b.importance),
  )

  lines.push('', 'WHAT IT ASKS FOR, AND WHAT THEY CAN SHOW FOR IT:')
  for (const item of sorted.slice(0, 14)) {
    const backing = item.evidenceIds.length > 0 ? ` [${item.evidenceIds.slice(0, 3).join(', ')}]` : ''
    lines.push(
      `- "${item.requirement.slice(0, 180)}" [${item.importance}] → ${item.verdict}${backing}: ${item.note.slice(0, 220)}`,
    )
  }

  try {
    const unknowns = JSON.parse(assessment.unknowns) as { description: string; side: string }[]
    const theirs = unknowns.filter((item) => item.side === 'opportunity').slice(0, 4)
    if (theirs.length > 0) {
      lines.push('', 'WHAT THE POSTING DOES NOT SAY:')
      for (const item of theirs) lines.push(`- ${item.description.slice(0, 180)}`)
    }
  } catch {
    // Sin huecos del anuncio se contesta igual.
  }

  return lines.join('\n')
}

/**
 * Leerla entera, con las mismas etapas y el mismo coste que cualquier otra.
 *
 * Reanudable porque `evaluateOpportunity` lo es: si esto se corta a mitad, lo
 * que ya se pagó sigue guardado y al volver empieza donde lo dejó.
 */
export async function readPastedOpportunity(opportunityId: string): Promise<void> {
  await evaluateOpportunity(opportunityId)
  // La oferta sabe de quién es. Preguntárselo al candidato global, teniéndolo
  // aquí delante, es la fuga que este proyecto tiene que dejar de tener.
  const opportunity = getOpportunity(opportunityId)
  if (!opportunity) return
  recordAuditEvent({
    candidate_id: opportunity.candidate_id,
    subject_type: 'opportunity',
    subject_id: opportunityId,
    event: 'pasted_opportunity_read',
    detail: {},
  })
}
