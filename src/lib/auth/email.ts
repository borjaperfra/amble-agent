import { dictionaries } from '../i18n/dictionaries'
import type { Locale } from '../i18n/locale'

// Sign-in emails go through Resend, from amble.fyi. Without a key (local
// development) the code is written to the server log instead.

const FROM = process.env.AMBLE_EMAIL_FROM ?? 'amble <hola@amble.fyi>'

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

// A short letter: the code, set large, and a button that does the same.
function loginHtml(t: (typeof dictionaries)['en']['login']['email'], code: string, link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:40px 16px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#25251f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;text-align:left">
<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;padding-bottom:28px">amble</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#67675f;padding-bottom:12px">${escapeHtml(t.intro)}</td></tr>
<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:34px;letter-spacing:0.28em;padding-bottom:28px">${escapeHtml(code)}</td></tr>
<tr><td style="padding-bottom:28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#25251f;color:#faf8f3;text-decoration:none;font-size:15px;font-weight:600;padding:14px 22px;border-radius:10px">${escapeHtml(t.button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6f6e65">${escapeHtml(t.footer)}</td></tr>
</table></td></tr></table></body></html>`
}

// Whether sign-in emails can go out: in production only with a key; in
// development they are written to the log.
export function signInEmailsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY) || process.env.NODE_ENV !== 'production'
}

// Any plain email from amble; without a key (local development) it goes to
// the log. On a server without one, what it says (someone's feedback) is not
// written there: only that it was not sent.
export async function sendEmail(params: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') console.warn('[amble] email not sent: RESEND_API_KEY is not set.')
    else console.info(`[amble] email to ${params.to}: ${params.subject}
${params.text}`)
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': params.idempotencyKey },
    body: JSON.stringify({ from: FROM, to: [params.to], subject: params.subject, text: params.text }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Resend refused the email (${response.status})`)
}

export async function sendLoginCode(params: {
  to: string
  code: string
  link: string
  locale: Locale
  idempotencyKey: string
}): Promise<void> {
  const t = dictionaries[params.locale].login.email
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is not set: sign-in codes cannot be sent.')
    console.info(`[amble] sign-in code for ${params.to}: ${params.code} · ${params.link}`)
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
      text: t.body(params.code, params.link),
      html: loginHtml(t, params.code, params.link),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend refused the sign-in email (${response.status}): ${detail.slice(0, 200)}`)
  }
}
