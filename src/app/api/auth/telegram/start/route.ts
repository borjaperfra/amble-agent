import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { appBase } from '@/lib/auth/applinks'
import { startLink, telegramConfig } from '@/lib/telegram/api'
import { createLogin, LOGIN_COOKIE, LOGIN_PREFIX } from '@/lib/telegram/login'
import { allow } from '@/lib/whatsapp/throttle'

export const runtime = 'nodejs'

// «Entrar con Telegram» (#35), opened in a tab of its own: a one-time code
// for the bot and, in this browser's cookie, the secret the login page then
// asks with (/api/auth/telegram/poll). On to the bot, which asks them to
// confirm in their chat.
const PER_ADDRESS = 10
const WINDOW_MS = 15 * 60 * 1000

export async function GET(request: Request) {
  const config = telegramConfig()
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!config || !allow('telegram-login', address, PER_ADDRESS, WINDOW_MS)) return NextResponse.redirect(`${appBase()}/login`)
  const login = createLogin()
  ;(await cookies()).set(LOGIN_COOKIE, login.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: login.expires,
  })
  return NextResponse.redirect(startLink(config, `${LOGIN_PREFIX}${login.code}`))
}
