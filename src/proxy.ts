import { NextResponse, type NextRequest } from 'next/server'

// Two checks before a request goes on, both cheap.
//
// A change asked of the API (anything but reading) comes from amble's own
// pages or from no browser at all (the WhatsApp provider, the owner's curl).
// A page on another site, even a sibling on amble.fyi, cannot make a visitor's
// browser sign in, pause their search or delete their account: the browser
// says where the request comes from (Sec-Fetch-Site, else Origin), and
// anything that is not this very site is refused.
//
// The product's pages, without a session cookie, send you to sign in: an
// optimistic check only. Whether the session is valid is decided by the page
// itself (src/lib/auth/session.ts), never here.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function ownOrigins(request: NextRequest): Set<string> {
  const origins = new Set([request.nextUrl.origin])
  // Behind the host's proxy, the address people use is the forwarded one.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) origins.add(`${request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(/:$/, '')}://${host}`)
  const configured = process.env.AMBLE_APP_URL
  if (configured) {
    try {
      origins.add(new URL(configured).origin)
    } catch {
      // A malformed setting adds nothing.
    }
  }
  return origins
}

function crossSite(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = request.headers.get('origin')
  // No Origin: not a browser's cross-site request (browsers send it on every POST).
  if (!origin) return false
  return !ownOrigins(request).has(origin)
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (!SAFE_METHODS.has(request.method) && crossSite(request)) {
      return NextResponse.json({ error: 'Not allowed from another site.' }, { status: 403 })
    }
    return NextResponse.next()
  }
  if (request.cookies.has('amble_session')) return NextResponse.next()
  const login = new URL('/login', request.url)
  login.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/api/:path*', '/me/:path*', '/listening', '/opportunities', '/onboarding/:path*', '/dev/:path*', '/invites', '/start', '/welcome', '/feedback'],
}
