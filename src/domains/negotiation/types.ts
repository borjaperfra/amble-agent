/**
 * Dos agentes averiguando lo que necesitan el uno del otro.
 *
 * El vocabulario, y nada más: ni base, ni modelo, ni red. Vive aquí por el
 * mismo motivo que las reglas de Opportunity Zero — lo que protege a alguien
 * tiene que poder leerse y probarse solo.
 *
 * Y hay algo que sólo se puede hacer aquí, en los tipos, y que si se deja
 * para después ya no se hace: **las decisiones del 19 sobre qué puede decir
 * cada lado dejan de ser política y pasan a ser la forma de los datos**.
 *
 * La que más se nota es la tercera. «Acordado» son los hard constraints de
 * los dos lados pasando y ninguno con un desconocido bloqueante, calculado
 * por el código de cada parte. Ningún agente declara el acuerdo — así que
 * aquí **no existe un turno de tipo «acuerdo»**. No es que esté prohibido: es
 * que no hay dónde escribirlo. Una regla que se puede saltar escribiendo un
 * campo distinto no es una regla, es una recomendación.
 */

/**
 * Quién habla.
 *
 * `rep` es el agente de la persona, `employer` el de la oferta. Ninguno de
 * los dos es «el sistema»: no hay un tercero neutral que sepa las dos cosas,
 * y esa ausencia es el diseño.
 */
export const SIDES = ['rep', 'employer'] as const
export type Side = (typeof SIDES)[number]

/**
 * Qué puede ser un turno.
 *
 * Preguntar y responder. Nada más, y esa es la decisión del 19 hecha tipo.
 * Un `stall` no es una tercera cosa que digan: es lo que pasa cuando uno no
 * puede responder sin molestar a su humano, y va marcado en la respuesta.
 */
export const TURN_KINDS = ['question', 'answer'] as const
export type TurnKind = (typeof TURN_KINDS)[number]

/**
 * Hasta dónde se puede contar de él, en este momento.
 *
 * `guarded` es antes de que él diga adelante: su Rep **sólo responde y nunca
 * ofrece**. Confirma o niega lo que la rúbrica pregunta, con la evidencia
 * detrás, y sus números no salen — a «¿cuál es su mínimo?» se contesta «lo
 * supera», nunca la cifra. Sin nombre, sin empresa actual, sin ciudad.
 *
 * `introduced` es después: nombre, historial y el Mapa.
 *
 * No hay un tercer nivel con más cosas. Lo que nunca sale sin que él lo pida
 * expresamente no depende del nivel — ver `NEVER_WITHOUT_ASKING`.
 */
export const DISCLOSURE_TIERS = ['guarded', 'introduced'] as const
export type DisclosureTier = (typeof DISCLOSURE_TIERS)[number]

/**
 * Lo que puede contener una respuesta del Rep.
 *
 * Cada clase por separado porque el nivel de divulgación las trata distinto,
 * y mezclarlas en «texto» sería perder justo la distinción que hay que
 * comprobar.
 */
export const FACT_KINDS = [
  /** Un sí o un no a lo que pregunta la rúbrica, con evidencia detrás. */
  'constraint',
  /** Una capacidad suya, citable. */
  'capability',
  /** Un número suyo: suelo salarial, años, tamaño de equipo. */
  'figure',
  /** Quién es: nombre, empresa actual, ciudad. */
  'identity',
  /** Lo que escribió él, en bruto: sus noes, sus dudas, sus respuestas. */
  'verbatim',
] as const
export type FactKind = (typeof FACT_KINDS)[number]

/**
 * Lo que no sale nunca sin que lo pida él, sea cual sea el nivel.
 *
 * Sus «no» tal cual los escribió, sus dudas sobre el empleo actual, y las
 * respuestas de la entrevista en bruto. Un «no» en sus palabras dice mucho
 * más que un no, y las dudas sobre dónde trabaja ahora pueden costarle el
 * trabajo que tiene.
 */
export const NEVER_WITHOUT_ASKING: readonly FactKind[] = ['verbatim']

/** Un hecho que el Rep podría decir, con lo que lo sostiene. */
export interface DisclosableFact {
  kind: FactKind
  /** Lo que se diría, tal cual. */
  text: string
  /** El número de dentro, cuando lo hay. Es lo que se redacta. */
  value?: number
  /** Ids del grafo. Sin esto no se dice: la respuesta tiene que citarse. */
  evidenceIds: string[]
  /** True cuando lo pidió él expresamente. */
  releasedByCandidate?: boolean
}

export interface NegotiationTurn {
  side: Side
  kind: TurnKind
  text: string
  /** Lo que sostiene la respuesta. Una pregunta no necesita nada. */
  facts: DisclosableFact[]
  /**
   * No puede seguir sin preguntarle a su humano. La conversación se para
   * aquí: es la única razón admitida para molestar a alguien.
   */
  needsHuman?: { who: Side; question: string }
}

/**
 * En qué punto está.
 *
 * `agreed` y `dead` las escribe el código mirando las señales de los dos
 * lados, nunca un agente. `stalled` es lo que activa molestar a un humano.
 */
export const NEGOTIATION_STATES = ['open', 'stalled', 'agreed', 'dead'] as const
export type NegotiationState = (typeof NEGOTIATION_STATES)[number]

/**
 * Lo que cada lado concluye con sus propias reglas.
 *
 * Deliberadamente el mismo par de cosas que `decisionSignals` ya produce en
 * Opportunity Zero: los hard constraints que fallan y los desconocidos
 * bloqueantes. La decisión 3 dice literalmente que «acordado» es eso corrido
 * dos veces, una con las reglas de cada parte.
 */
export interface SideSignals {
  hardFails: number
  blockingUnknowns: number
}
