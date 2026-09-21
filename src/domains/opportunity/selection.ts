/**
 * Cuánta evidencia se le manda al modelo, y cuál.
 *
 * El problema medido, no supuesto: el prompt de match son ~32.000 caracteres
 * y el **67% son evidencias**. Se mandan las 99 que hay. Y mirando las seis
 * evaluaciones que ya corrieron, el modelo citó entre 10 y 28 — nunca más de
 * 28, y 45 de las 99 no las citó ninguna, jamás.
 *
 * O sea que hoy se paga por mandar tres veces lo que se usa. Pero recortar
 * por eso sería optimizar la factura de hoy, y ese no es el problema. El
 * problema es que **crece**: cada respuesta suya añade evidencias, y con
 * quinientas el prompt no cabe. Un producto que se rompe solo cuanto mejor te
 * conoce está roto de una forma especialmente fea.
 *
 * Así que un techo, y una forma de elegir que no sea arbitraria.
 *
 * El fallo que hay que evitar al elegir no es mandar de más: es dejarse
 * fuera la prueba que sostenía un requisito, porque entonces sale un
 * `NOT_SUPPORTED` que es mentira y una oferta buena se cae en silencio. Por
 * eso el techo es el doble largo de lo que nunca se ha usado, y por eso la
 * relevancia sólo **ordena** — nunca excluye sola.
 */

import type { OpportunityRubric } from './types'

/**
 * Sesenta.
 *
 * Más del doble de las 28 que el modelo llegó a citar en su mejor día. Si
 * algún día cita más de sesenta, este número está mal y hay que subirlo — y
 * se verá, porque se registra cuántas se mandaron y cuántas había.
 */
export const MAX_EVIDENCE_FOR_MATCH = 60

/**
 * Lo que hace falta para elegir, y nada más.
 *
 * Un subconjunto de `EvidenceRow` y no la fila entera: así esta función se
 * puede probar sin base, que es la razón de que viva aquí y no en el
 * pipeline. `confidence` admite nulo porque en la base lo admite, y una
 * evidencia sin confianza no es un error — es una que nadie puntuó.
 */
export interface SelectableEvidence {
  id: string
  statement: string
  strength: string
  confidence: number | null
  candidate_confirmed: number
}

export interface SelectableCapability {
  id: string
  name: string
  reason: string
}

/** Palabras que aparecen en cualquier anuncio y no distinguen nada. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'that', 'this', 'from', 'are', 'have', 'has',
  'will', 'can', 'not', 'their', 'they', 'who', 'what', 'work', 'team', 'role', 'years',
  'experience', 'skills', 'strong', 'good', 'ability', 'able', 'including', 'across',
  'los', 'las', 'del', 'que', 'con', 'para', 'por', 'una', 'uno', 'como', 'más', 'sus',
])

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  )
}

/**
 * De qué va la oferta, en palabras sueltas.
 *
 * Los requisitos y el encuadre del puesto. No la empresa ni la ubicación: eso
 * no dice nada sobre qué pruebas suyas hacen falta para sostenerlo.
 */
export function rubricTerms(rubric: OpportunityRubric): Set<string> {
  return terms(
    [
      rubric.roleScope ?? '',
      rubric.seniority ?? '',
      rubric.industry ?? '',
      ...rubric.requirements.map((requirement) => requirement.text),
      ...rubric.preferences,
    ].join(' '),
  )
}

/**
 * Las evidencias que se mandan, ordenadas por lo que pesan aquí.
 *
 * Cuatro cosas suman, y en este orden por un motivo:
 *
 * - Que la sostenga una capacidad que la oferta toca. Es lo único que habla
 *   de *esta* oferta, así que pesa el doble que lo demás.
 * - Que el propio texto de la evidencia hable de lo que pide el anuncio.
 * - Que sea fuerte, que él la haya confirmado, y su confianza. Eso no depende
 *   de la oferta: es lo que hace que una prueba valga en cualquier sitio, y
 *   es el desempate cuando la oferta es rara y nada se parece a ella.
 *
 * La relevancia ordena pero no excluye: si el anuncio está escrito de forma
 * que no se parece a nada suyo, la lista se llena igual con lo mejor que
 * tiene, en vez de mandar tres evidencias y concluir que no vale para nada.
 */
export function selectEvidenceForMatch(
  evidence: readonly SelectableEvidence[],
  capabilities: readonly SelectableCapability[],
  capabilityEvidence: ReadonlyMap<string, string[]>,
  rubric: OpportunityRubric,
  limit = MAX_EVIDENCE_FOR_MATCH,
): SelectableEvidence[] {
  if (evidence.length <= limit) return [...evidence]

  const wanted = rubricTerms(rubric)
  const overlap = (text: string): number => {
    let hits = 0
    for (const term of terms(text)) if (wanted.has(term)) hits += 1
    return hits
  }

  // Qué capacidades toca la oferta, y cuánto.
  const capabilityScore = new Map<string, number>()
  for (const capability of capabilities) {
    capabilityScore.set(capability.id, overlap(`${capability.name} ${capability.reason}`))
  }

  // Y de ahí, qué evidencias heredan ese peso.
  const inherited = new Map<string, number>()
  for (const [capabilityId, ids] of capabilityEvidence) {
    const score = capabilityScore.get(capabilityId) ?? 0
    if (score === 0) continue
    for (const id of ids) inherited.set(id, Math.max(inherited.get(id) ?? 0, score))
  }

  const strengthScore: Record<string, number> = { strong: 2, some: 1, weak: 0 }

  return [...evidence]
    .map((item) => ({
      item,
      score:
        (inherited.get(item.id) ?? 0) * 2 +
        overlap(item.statement) +
        (strengthScore[item.strength] ?? 0) +
        (item.candidate_confirmed === 1 ? 1 : 0) +
        (item.confidence ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.item)
}
