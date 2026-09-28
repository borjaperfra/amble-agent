import { NextResponse, type NextRequest } from 'next/server'

// An optimistic check only: without a session cookie, the product's pages send
// you to sign in. Whether the session is valid is decided by the page itself
// (src/lib/auth/session.ts), never here.
export function proxy(request: NextRequest) {
  if (request.cookies.has('amble_session')) return NextResponse.next()
  const login = new URL('/login', request.url)
  login.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/me/:path*', '/listening', '/opportunities', '/onboarding/:path*', '/dev/:path*', '/invites'],
}
