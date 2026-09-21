/**
 * Las guardas de la única petición que este servidor hace a donde le digan.
 *
 * Todo lo demás en Amble llega de feeds que elegimos nosotros. Esto es un
 * enlace que alguien pega en un chat, y eso convierte al servidor en un
 * navegador que obedece — que es la mitad de una SSRF ya hecha.
 *
 * Lo que se prueba es que no se puede usar para mirar dentro de la casa.
 * Railway corre esto junto a su propia red interna, y `169.254.169.254` es el
 * servicio de metadatos de casi todas las nubes: el sitio donde viven las
 * credenciales de la máquina.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertPublicUrl, fetchPosting, FetchRefused, textFromHtml } from './pasted'

async function refused(url: string): Promise<string> {
  try {
    await assertPublicUrl(url)
    return '(no lo rechazó)'
  } catch (error) {
    if (error instanceof FetchRefused) return error.message
    throw error
  }
}

describe('a dónde se deja ir', () => {
  it('sólo https: file:// leería el disco del contenedor', async () => {
    assert.match(await refused('file:///etc/passwd'), /only open https/)
    assert.match(await refused('http://example.com/job'), /only open https/)
  })

  it('no a la dirección de metadatos de la nube', async () => {
    // Ahí viven las credenciales de la máquina en AWS, GCP y Azure.
    assert.match(await refused('https://169.254.169.254/latest/meta-data/'), /not on the public/)
  })

  it('no a sí mismo ni a la red privada', async () => {
    assert.match(await refused('https://127.0.0.1/'), /not on the public/)
    assert.match(await refused('https://10.0.0.5/'), /not on the public/)
    assert.match(await refused('https://192.168.1.1/'), /not on the public/)
    assert.match(await refused('https://172.16.4.4/'), /not on the public/)
  })

  it('tampoco escrita en IPv6, que es el mismo sitio con otro traje', async () => {
    assert.match(await refused('https://[::1]/'), /not on the public/)
    assert.match(await refused('https://[::ffff:169.254.169.254]/'), /not on the public/)
  })

  it('y lo que no es un enlace, no lo es', async () => {
    assert.match(await refused('no soy una url'), /not a link/)
  })
})

describe('siguiendo una redirección', () => {
  const realFetch = globalThis.fetch

  it('comprueba el destino, no sólo el punto de partida', async () => {
    // El ataque que esto para: un destino público perfectamente legítimo que
    // redirige al servicio de metadatos. Comprobar sólo la primera URL deja
    // pasar eso con una sola cabecera.
    //
    // Se parte de una IP pública literal y no de un dominio: `dns.lookup` la
    // devuelve tal cual, así que el test no depende de que haya red.
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data/' },
      })) as typeof fetch

    try {
      await assert.rejects(
        () => fetchPosting('https://93.184.216.34/job'),
        (error: unknown) =>
          error instanceof FetchRefused && /not on the public/.test(error.message),
      )
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('no se queda dando vueltas para siempre', async () => {
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://93.184.216.34/again' },
      })) as typeof fetch

    try {
      await assert.rejects(
        () => fetchPosting('https://93.184.216.34/job'),
        (error: unknown) => error instanceof FetchRefused && /bounces around/.test(error.message),
      )
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('el anuncio, en texto', () => {
  it('se lleva por delante el script y el estilo', () => {
    const text = textFromHtml(
      '<p>Head of Growth</p><script>alert(1)</script><style>p{color:red}</style><p>Remote</p>',
    )
    assert.doesNotMatch(text, /alert|color:red/)
    assert.match(text, /Head of Growth/)
    assert.match(text, /Remote/)
  })

  it('deja los bloques en líneas, que es como se lee un anuncio', () => {
    assert.equal(textFromHtml('<li>Python</li><li>SQL</li>').replace(/ +/g, ' ').trim(), '- Python\n- SQL')
  })

  it('termina de deshacer las entidades, y no a medias', () => {
    // Dejar «&amp;» en mitad de una frase es como se nota que nadie leyó la
    // salida.
    assert.equal(textFromHtml('<p>Growth &amp; Marketing</p>'), 'Growth & Marketing')
  })
})
