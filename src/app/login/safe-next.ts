// Where to go after signing in: only a path inside the product, never another
// site, and never back to signing in.
//
// A path of this site is one slash, then anything but another slash or a
// backslash (browsers read "/\evil.com" as "//evil.com"), with no control
// characters. It is resolved as the browser would ("/./x", "%2e%2e") and
// checked again.
const LOCAL_PATH = /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/
const BASE = 'http://amble.invalid'

export function safeNext(value: string | string[] | undefined): string {
  const next = typeof value === 'string' ? value : ''
  if (!LOCAL_PATH.test(next)) return '/start'
  let path: string
  try {
    const url = new URL(next, BASE)
    if (url.origin !== BASE) return '/start'
    path = url.pathname + url.search + url.hash
  } catch {
    return '/start'
  }
  return LOCAL_PATH.test(path) && !path.startsWith('/login') ? path : '/start'
}
