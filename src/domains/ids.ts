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
