/**
 * Los ids internos, fuera de lo que lee una persona.
 *
 * Vivía dentro de las reglas del asesor porque ahí fue donde hizo falta
 * primero. Pero no es un problema del asesor: el 22 de septiembre Borja miró
 * su propio Mapa y preguntó por qué había «urls metidas ahí en el medio».
 * Eran esto:
 *
 *     "Market research sit inside documented GTM roles
 *      (ev_fc5e68e749254b87, ev_72093f7779ee4607) alongside quantified
 *      outcomes (ev_cd10f0ae176943e8)…"
 *
 * Su perfil, con nuestro sistema de archivo dentro. Y no es que faltara el
 * filtro —existía y se aplicaba al escribir— es que **lo ya guardado nadie lo
 * limpia nunca**. De ahí que esto tenga que correr también al leer.
 *
 * Los prefijos están comprobados contra la base y contra las llamadas a
 * `newId()`, no supuestos: una versión anterior buscaba `unc_` y se dejaba
 * `unk_`, y un filtro que se deja la mitad es peor que ninguno porque parece
 * que funciona.
 */

const ID_PREFIXES =
  'unc|unk|ev|opp|clm|int|intent|intn|cap|req|hc|src|turn|dec|rub|asmt|oq|adv|run|job|fb|in|web'

const ID = new RegExp(`\\b(?:${ID_PREFIXES})_[A-Za-z0-9][A-Za-z0-9_]*\\b`, 'g')

/** Uno o varios entre paréntesis o corchetes, que es como los escribe. */
const BRACKETED = new RegExp(
  `\\s*[([]\\s*(?:${ID_PREFIXES})_[A-Za-z0-9][A-Za-z0-9_]*` +
    `(?:\\s*[,;]\\s*(?:${ID_PREFIXES})_[A-Za-z0-9][A-Za-z0-9_]*)*\\s*[)\\]]`,
  'g',
)

/**
 * Y lo que queda después de quitarlos.
 *
 * Quitar «(ev_a, ev_b)» de «roles (ev_a, ev_b) alongside» deja «roles
 * alongside», pero quitarlo de «Amplitude; ev_a, ev_b)» deja «Amplitude;,.» —
 * que se lee peor que el id. Limpiar la puntuación huérfana es la mitad del
 * trabajo, no un detalle.
 */
export function stripIds(text: string): string {
  return text
    .replace(BRACKETED, '')
    .replace(ID, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    // Puntuación que se ha quedado sola: «(Google Analytics;,.» → «(Google Analytics.»
    .replace(/([;,:])\s*(?=[.,;:)\]])/g, '')
    .replace(/\s*([,;:])\s*\)/g, ')')
    .replace(/\(\s*([^()]*?)\s*[;,:]\s*\)/g, '($1)')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*\./g, '.')
    .trim()
}

/**
 * Un puente, y dicho como tal.
 *
 * El prompt de reevaluación escribía el motivo de una capacidad como una nota
 * sobre *esa* reevaluación: «Unchanged. The message was not an account of
 * work — the candidate shared a Cloudflare job link…». En su perfil no hay
 * ningún mensaje delante, así que eso se lee como si su carrera fuera un
 * registro de cambios.
 *
 * El prompt ya está arreglado (v2), pero lo escrito sigue escrito hasta que
 * vuelva a pasar por ahí — y eso sólo ocurre cuando él cuenta algo. Así que
 * esto limpia al leer.
 *
 * Es un puente y se nota que lo es: cuando esas filas se hayan reescrito,
 * sobra. Lo que hace es quedarse con la parte que describe —el modelo la
 * marcaba con «Basis remains:»— y si no la hay, tirar la frase de delante que
 * sólo tenía sentido al lado del mensaje que ya no está.
 */
const DELTA_OPENER =
  /^(unchanged|no new evidence|this (message|response)|sin cambios)\b[^.]*\.\s*/i

const STANDING_MARKER = /\b(basis remains|la base sigue siendo)\s*:?\s*/i

export function standingDescription(text: string): string {
  const clean = stripIds(text)

  const marker = STANDING_MARKER.exec(clean)
  if (marker && marker.index + marker[0].length < clean.length) {
    const kept = clean.slice(marker.index + marker[0].length).trim()
    return kept.charAt(0).toUpperCase() + kept.slice(1)
  }

  // En bucle, no una sola vez: el modelo encadenaba varias —«Unchanged. No
  // new evidence. …»— y quitar sólo la primera deja la segunda, que es
  // exactamente igual de ilegible.
  let withoutDelta = clean
  for (let pass = 0; pass < 4; pass += 1) {
    const next = withoutDelta.replace(DELTA_OPENER, '').trim()
    if (next === withoutDelta || next.length === 0) break
    withoutDelta = next
  }
  return withoutDelta.length > 0 ? withoutDelta : clean
}
