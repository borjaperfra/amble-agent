import { NextResponse } from 'next/server'
import { SESSION_COOKIE, SESSION_MAX_AGE, gatePassword, passwordMatches, sessionToken } from '@/lib/gate'

export const runtime = 'nodejs'

/**
 * Entrar.
 *
 * Una contraseña, la cookie, y ya está. Sin registro, sin recuperación y sin
 * nada que recordar: si se pierde, se cambia la variable en Railway y se
 * vuelve a desplegar, que es más corto que cualquier flujo de «olvidé mi
 * contraseña» que pudiera escribirse aquí.
 */
export async function POST(request: Request) {
  const password = gatePassword()
  if (!password) {
    return NextResponse.json({ error: 'There is no password set.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const given = typeof body?.password === 'string' ? body.password : ''
  if (!passwordMatches(given, password)) {
    return NextResponse.json({ error: 'Esa no es.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    // En local se sirve por http y una cookie `secure` no llegaría nunca.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return response
}

/** Salir, por si alguna vez se abre en un móvil que no es el suyo. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}
