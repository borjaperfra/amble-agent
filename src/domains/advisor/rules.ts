/**
 * El asesor, auditado.
 *
 * Aquí las reglas y nada más: ni base, ni proveedor, ni Next. Vive al lado de
 * las de Opportunity Zero y por el mismo motivo — lo que protege a alguien de
 * que le cuenten cosas sobre sí mismo tiene que poder leerse y probarse solo.
 *
 * El problema que resuelve es concreto. Cuando el Rep pasa de decidir a
 * aconsejar, empieza a hacer afirmaciones sobre él —«tus métricas son
 * autodeclaradas», «no tienes profundidad analítica»— y esas afirmaciones se
 * leen como verdades. En una decisión, si el modelo se inventa algo, las
 * reglas la tumban. En un consejo no hay nada que tumbar: se lee y se cree.
 *
 * Así que la misma disciplina que la explicación de una oferta, con la misma
 * frase: **lo que no se puede trazar se descarta en vez de enseñarse, y se
 * cuenta, porque la cuenta es la medida. Objetivo: cero.**
 *
 * Y una regla que sale de esto y no es obvia: si no queda ningún punto en
 * pie, el Rep no contesta igualmente con algo vago. Dice que no puede
 * contestar eso con lo que sabe. Un asesor que siempre tiene algo que decir
 * está completando frases.
 */

/** De dónde puede colgar una afirmación sobre él. */
export interface AdvisorGrounds {
  evidenceIds: readonly string[]
  uncertaintyIds: readonly string[]
  opportunityIds: readonly string[]
}

/** Una cosa dicha, con lo que la sostiene. */
export interface AdvisorPoint {
  text: string
  evidenceIds: string[]
  uncertaintyIds: string[]
  opportunityIds: string[]
}

export interface AdvisorDraft {
  points: AdvisorPoint[]
  /** Una pregunta de vuelta. No afirma nada, así que no necesita apoyo. */
  askBack: string | null
}

export interface DroppedPoint {
  text: string
  why: string
}

export interface AdvisorAudit {
  points: AdvisorPoint[]
  askBack: string | null
  /** Lo que se cayó. La cuenta es la medida: objetivo cero. */
  dropped: DroppedPoint[]
}

/**
 * Los ids son fontanería, no lenguaje.
 *
 * El modelo los cuela en la prosa —«tus métricas son autodeclaradas
 * (unc_60a5d2…)»— porque le hemos pedido que cite, y entonces el candidato
 * lee un identificador interno en un consejo sobre su carrera. Fuera del
 * texto; la trazabilidad vive en los campos, que es donde se puede comprobar.
 *
 * Los prefijos están comprobados contra la base y contra las llamadas a
 * `newId()`, no supuestos: la primera versión de esto buscaba `unc_` y se
 * dejaba `unk_`, que es el que usan los ids de huecos dentro de un análisis.
 * Un filtro que se deja la mitad es peor que ninguno, porque parece que
 * funciona.
 */
const ID_PREFIXES =
  'unc|unk|ev|opp|clm|int|intent|intn|cap|req|hc|src|turn|dec|rub|asmt|oq|adv'

const ID = new RegExp(`\\b(?:${ID_PREFIXES})_[A-Za-z0-9][A-Za-z0-9_]*\\b`, 'g')

/** Uno o varios entre paréntesis o corchetes, que es como los escribe. */
const BRACKETED = new RegExp(
  `\\s*[([]\\s*(?:${ID_PREFIXES})_[A-Za-z0-9][A-Za-z0-9_]*` +
    `(?:\\s*[,;]\\s*(?:${ID_PREFIXES})_[A-Za-z0-9][A-Za-z0-9_]*)*\\s*[)\\]]`,
  'g',
)

export function stripIds(text: string): string {
  return text
    .replace(BRACKETED, '')
    .replace(ID, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .trim()
}

/**
 * Cada punto tiene que apoyarse en algo que exista, o se cae.
 *
 * «Existe» significa comprobado contra el grafo, no contra lo que el modelo
 * crea recordar: un id inventado es exactamente igual de convincente que uno
 * real, y la diferencia sólo la ve el código.
 */
export function auditAdvice(draft: AdvisorDraft, grounds: AdvisorGrounds): AdvisorAudit {
  const evidence = new Set(grounds.evidenceIds)
  const uncertainties = new Set(grounds.uncertaintyIds)
  const opportunities = new Set(grounds.opportunityIds)

  const points: AdvisorPoint[] = []
  const dropped: DroppedPoint[] = []

  for (const point of draft.points) {
    const text = stripIds(point.text)
    if (text.length === 0) continue

    const cited = {
      evidenceIds: point.evidenceIds.filter((id) => evidence.has(id)),
      uncertaintyIds: point.uncertaintyIds.filter((id) => uncertainties.has(id)),
      opportunityIds: point.opportunityIds.filter((id) => opportunities.has(id)),
    }
    const total =
      cited.evidenceIds.length + cited.uncertaintyIds.length + cited.opportunityIds.length

    if (total === 0) {
      const claimed =
        point.evidenceIds.length + point.uncertaintyIds.length + point.opportunityIds.length
      dropped.push({
        text,
        why:
          claimed > 0
            ? 'Points at ids that are not in the graph.'
            : 'Says something about the candidate with nothing behind it.',
      })
      continue
    }

    points.push({ text, ...cited })
  }

  return {
    points,
    askBack: draft.askBack ? stripIds(draft.askBack) || null : null,
    dropped,
  }
}

/**
 * El consejo, escrito.
 *
 * Sin viñetas ni numeración: esto llega a un chat y se lee como un mensaje,
 * no como un informe. Las fuentes no van en el texto — van al lado, en los
 * campos, y la pantalla las enseña si alguien quiere mirarlas.
 */
export function renderAdvice(audit: AdvisorAudit, nothingToSay: string): string {
  const lines = audit.points.map((point) => point.text)
  if (lines.length === 0) {
    // No hay nada que se sostenga. Decirlo es la respuesta, y es mejor
    // respuesta que un párrafo amable construido sobre nada.
    return audit.askBack ? `${nothingToSay}\n\n${audit.askBack}` : nothingToSay
  }
  if (audit.askBack) lines.push(audit.askBack)
  return lines.join('\n\n')
}
