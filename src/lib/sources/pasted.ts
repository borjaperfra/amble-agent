/**
 * Una oferta que te pasa él.
 *
 * Todo lo demás en Amble llega de un feed que nosotros elegimos. Esto es lo
 * contrario: un enlace que alguien pega en un chat, de un dominio cualquiera,
 * y que hay que ir a buscar. Es la única vez que este servidor hace una
 * petición a donde le digan, y por eso tiene más guardas que ninguna otra
 * cosa del proyecto.
 *
 * Las guardas, y el porqué de cada una:
 *
 * - **Sólo https.** `file://` leería el disco del contenedor y `http://`
 *   dentro de una red privada es media SSRF ya hecha.
 * - **Sólo direcciones públicas, resueltas antes de pedir.** Railway corre
 *   esto junto a su propia red interna: `http://169.254.169.254` es el
 *   servicio de metadatos en casi todas las nubes, y `amble.railway.internal`
 *   resuelve a un vecino. Comprobar el nombre no vale — hay que resolver.
 * - **Las redirecciones se siguen a mano, comprobando cada salto.** Rechazarlas
 *   sin más suena seguro y es inservible: `boards.greenhouse.io` redirige a
 *   `job-boards.greenhouse.io` y así casi todos los tablones, o sea que no se
 *   podría leer ninguna oferta. Y seguirlas a ciegas es peor que no
 *   comprobar nada — un dominio público que redirige a `169.254.169.254` se
 *   salta la comprobación entera con una sola cabecera. Así que se siguen
 *   pocas y cada destino pasa por el mismo filtro que el primero.
 * - **Un tope de tamaño y de tiempo.** Un fichero de dos gigas contestado muy
 *   despacio tumba el proceso, y con él la cola.
 *
 * Lo que sale de aquí es texto de un desconocido, y aguas abajo va vallado
 * como el de cualquier anuncio. Esto no lo sustituye: son dos problemas.
 */

import dns from 'node:dns/promises'
import net from 'node:net'

export class FetchRefused extends Error {}

/** Más que esto no es un anuncio, es un sitio web entero. */
const MAX_BYTES = 2_000_000
const TIMEOUT_MS = 15_000

/**
 * Tres saltos.
 *
 * Los tablones reales dan uno, a veces dos —dominio viejo, luego `www`, luego
 * la página—. Más allá de tres es una cadena de acortadores o un bucle, y
 * ninguna de las dos cosas es una oferta de trabajo.
 */
const MAX_HOPS = 3

/**
 * Si esa dirección es del mundo o de dentro de casa.
 *
 * `net.BlockList` sabe de rangos y de las dos familias, que a mano es donde
 * se cuelan los fallos: `::ffff:169.254.169.254` es la misma dirección de
 * metadatos escrita en IPv6 y se salta cualquier comprobación de texto.
 */
function isPrivate(address: string): boolean {
  const list = new net.BlockList()
  list.addSubnet('10.0.0.0', 8, 'ipv4')
  list.addSubnet('172.16.0.0', 12, 'ipv4')
  list.addSubnet('192.168.0.0', 16, 'ipv4')
  list.addSubnet('127.0.0.0', 8, 'ipv4')
  list.addSubnet('169.254.0.0', 16, 'ipv4')
  list.addSubnet('100.64.0.0', 10, 'ipv4')
  list.addSubnet('0.0.0.0', 8, 'ipv4')
  list.addSubnet('::1', 128, 'ipv6')
  list.addSubnet('fc00::', 7, 'ipv6')
  list.addSubnet('fe80::', 10, 'ipv6')

  const family = net.isIPv6(address) ? 'ipv6' : 'ipv4'
  if (list.check(address, family)) return true

  // Una IPv4 escrita como IPv6 es la misma máquina con otro traje.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return mapped ? isPrivate(mapped[1]) : false
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FetchRefused('That is not a link I can open.')
  }

  if (url.protocol !== 'https:') {
    throw new FetchRefused('I only open https links.')
  }

  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => [])
  if (addresses.length === 0) {
    throw new FetchRefused('That address does not resolve.')
  }
  if (addresses.some((entry) => isPrivate(entry.address))) {
    throw new FetchRefused('That address is not on the public internet.')
  }

  return url
}

/**
 * El anuncio, en texto.
 *
 * Sin intentar entender la página: fuera el script y el estilo, los bloques
 * en líneas, y lo que quede. Un extractor listo acertaría más y fallaría de
 * formas más raras, y lo que viene después —la rúbrica— ya es un modelo
 * leyendo prosa.
 */
export function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface FetchedPosting {
  url: string
  text: string
}

export async function fetchPosting(raw: string): Promise<FetchedPosting> {
  let url = await assertPublicUrl(raw)
  let response: Response | null = null

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    response = await fetch(url, {
      // A mano, para poder comprobar a dónde lleva antes de ir.
      redirect: 'manual',
      headers: { 'User-Agent': 'amble/0.1 (+candidate pasted this link)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null)

    if (!response) throw new FetchRefused('I could not reach that page.')
    if (response.status < 300 || response.status >= 400) break

    const location = response.headers.get('location')
    if (!location) throw new FetchRefused('That link goes nowhere.')
    if (hop === MAX_HOPS) throw new FetchRefused('That link bounces around too much.')

    // Relativa o absoluta, y la comprobación es la misma: lo que importa no
    // es de dónde viene el salto, es a dónde va.
    url = await assertPublicUrl(new URL(location, url).toString())
  }

  if (!response) throw new FetchRefused('I could not reach that page.')
  if (!response.ok) throw new FetchRefused(`That page answered ${response.status}.`)

  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > MAX_BYTES) throw new FetchRefused('That page is too big to read.')

  const body = await response.text()
  if (body.length > MAX_BYTES) throw new FetchRefused('That page is too big to read.')

  const text = textFromHtml(body)
  if (text.length < 200) {
    // Casi siempre es una página que se dibuja con JavaScript y llega vacía.
    throw new FetchRefused('I could not read anything on that page. Paste me the text instead.')
  }

  return { url: url.toString(), text: text.slice(0, 40_000) }
}
