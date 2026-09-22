/**
 * Que cada pantalla abra.
 *
 *   npm run smoke                 # contra el dev server local
 *   npm run smoke -- <url>        # contra lo desplegado
 *
 * Existe por un fallo concreto. El 21 de septiembre, `/feedback` devolvía un
 * 500 en producción porque `node:sqlite` entrega las filas sin prototipo y
 * React se niega a pasarlas al cliente. Todo estaba en verde: tipos, lint,
 * 197 tests y el build. Lo encontré abriendo la página a mano.
 *
 * No es un arnés de componentes y no pretende serlo. Es la pregunta más
 * barata que existe —¿contesta 200?— hecha a todas las pantallas de una vez,
 * que es exactamente la clase de fallo que se escapa cuando nada renderiza
 * nada en los tests.
 *
 * Con contraseña si la hay: se la pide a la variable de entorno, porque un
 * script que la lleva escrita dentro acaba en un repositorio.
 */

import process from 'node:process'

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '')
const password = process.env.AMBLE_PASSWORD?.trim()

/**
 * Lo que una persona abre. El orden es el del recorrido real.
 *
 * Las de traza se marcan aparte porque son de desarrollo a propósito: hacen
 * `notFound()` cuando `NODE_ENV` es production. En el despliegue un 404 ahí
 * es lo correcto, y este script lo dice en vez de cantarlo como fallo — pero
 * lo dice, que es distinto de callarse.
 */
const PAGES = [
  // La portada es publica: es el enlace que se comparte.
  { path: '/', public: true },
  { path: '/listening' },
  { path: '/me' },
  { path: '/me/intent' },
  { path: '/feedback' },
  { path: '/onboarding' },
  { path: '/dev/user-zero', devOnly: true },
  { path: '/dev/opportunity-zero', devOnly: true },
]

/** Y lo que las pantallas piden mientras están abiertas. */
const ENDPOINTS = [
  '/api/health',
  '/api/waitlist',
  '/api/preferences',
  '/api/opportunities',
  '/api/opportunities/interruption',
  '/api/feedback',
  '/api/advice',
  '/api/reliability',
]

let cookie = ''
if (password) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    console.error(`No ha dejado entrar (HTTP ${response.status}). ¿Es esa la contraseña?`)
    process.exit(1)
  }
  cookie = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
}

let failures = 0

async function check(path, { html, devOnly = false }) {
  let response
  try {
    response = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} })
  } catch (error) {
    console.log(`  ✗ ${path.padEnd(34)} no contesta: ${error.message}`)
    failures += 1
    return
  }

  if (response.status === 404 && devOnly) {
    console.log(`  – ${path.padEnd(34)} 404 (sólo en desarrollo, correcto aquí)`)
    return
  }

  if (!response.ok) {
    console.log(`  ✗ ${path.padEnd(34)} HTTP ${response.status}`)
    failures += 1
    return
  }

  if (html) {
    const body = await response.text()
    // Next contesta 200 con la página de error dentro cuando algo revienta
    // en el servidor: mirar sólo el código de estado se lo traga entero.
    const broken =
      body.includes('Application error: a server-side exception') ||
      body.includes('__next_error__')
    if (broken) {
      console.log(`  ✗ ${path.padEnd(34)} 200, pero la página es un error`)
      failures += 1
      return
    }
    if (body.length < 500) {
      console.log(`  ✗ ${path.padEnd(34)} 200, pero está vacía (${body.length} car)`)
      failures += 1
      return
    }
  }

  console.log(`  · ${path.padEnd(34)} ${response.status}`)
}

console.log(`Contra ${base}${password ? ' (con contraseña)' : ''}\n`)
console.log('pantallas')
for (const page of PAGES) await check(page.path, { html: true, devOnly: page.devOnly })
console.log('\nendpoints')
for (const path of ENDPOINTS) await check(path, { html: false })

console.log()
if (failures > 0) {
  console.error(`${failures} fallo(s).`)
  process.exit(1)
}
console.log('Todo abre.')
