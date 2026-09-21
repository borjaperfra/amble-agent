import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, gatePassword, tokenMatches } from '@/lib/gate'

/**
 * Delante de todo, cuando hay contraseña.
 *
 * `middleware.ts` está deprecado en Next 16 y esto es lo que lo sustituye
 * —mismo comportamiento, otro nombre de fichero y de export— y desde esta
 * versión corre en el runtime de Node, que es lo que permite usar `crypto`
 * aquí en vez de montar una comparación a mano.
 *
 * Deja pasar la pantalla de entrar y su endpoint, y nada más. Los ficheros
 * estáticos se quedan fuera por el `matcher`: sin eso, la propia pantalla de
 * la contraseña se cargaría sin estilos.
 */
export function proxy(request: NextRequest) {
  const password = gatePassword()
  if (!password) return NextResponse.next()

  const { pathname } = request.nextUrl
  // La entrada, y el latido que mira Railway: si el chequeo de salud pidiera
  // contraseña, ningún despliegue llegaría a recibir tráfico.
  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/health') {
    return NextResponse.next()
  }

  if (tokenMatches(request.cookies.get(SESSION_COOKIE)?.value, password)) {
    return NextResponse.next()
  }

  // A la pantalla de entrar solo si venía a mirar algo. Una petición de la
  // propia app contestada con un HTML de login es un error de JSON raro diez
  // minutos después; un 401 se lee.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const login = new URL('/login', request.url)
  // Para volver a donde iba. Solo rutas de aquí: un `next` con un dominio
  // dentro convierte esta pantalla en un redirector abierto.
  if (pathname !== '/') login.searchParams.set('next', pathname)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
}
