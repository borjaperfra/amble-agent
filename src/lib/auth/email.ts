import { dictionaries } from '../i18n/dictionaries'
import type { Locale } from '../i18n/locale'

// Sign-in emails go through Resend, from amble.fyi. Without a key (local
// development) the code is written to the server log instead.

const FROM = process.env.AMBLE_EMAIL_FROM ?? 'Amble <hola@amble.fyi>'

export async function sendLoginCode(params: { to: string; code: string; locale: Locale; idempotencyKey: string }): Promise<void> {
  const t = dictionaries[params.locale].login.email
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is not set: sign-in codes cannot be sent.')
    console.info(`[amble] sign-in code for ${params.to}: ${params.code}`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // A retried request must not send a second email with the same code.
      'Idempotency-Key': params.idempotencyKey,
    },
    body: JSON.stringify({
      from: FROM,
      to: [params.to],
      subject: t.subject(params.code),
      text: t.body(params.code),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend refused the sign-in email (${response.status}): ${detail.slice(0, 200)}`)
  }
}
