import { renderLetterHtml, renderLetterText, type Letter } from '../email/templates'
import type { Locale } from '../i18n/locale'

// The letter that lets someone on the waitlist into the beta: from Borja, in
// the voice of the site's welcome email, with their own link. Without a key
// (local development) it goes to the server log; on a server without one it
// is not sent, and the owner can still copy the link.

const FROM = process.env.AMBLE_EMAIL_FROM ?? 'amble <hola@amble.fyi>'
// Answers reach Borja, not a mailbox nobody reads.
const REPLY_TO = process.env.AMBLE_INVITE_REPLY_TO ?? 'borja@amble.fyi'

const copy: Record<Locale, (link: string) => Letter & { subject: string }> = {
  es: (link) => ({
    lang: 'es',
    subject: 'Ya tienes sitio en la beta de amble',
    preheader: 'Tu enlace para entrar, solo para ti.',
    intro: [
      'Hola,',
      'Te apuntaste a la lista de espera de amble y ya hay sitio para ti en la beta :)',
      'amble es un agente que busca trabajo por ti: entiende lo que has hecho, lee las ofertas y solo te trae las que de verdad encajan.',
    ],
    button: { label: 'Entrar en amble', href: link },
    fallback: 'Si el botón no funciona, copia este enlace en el navegador:',
    outro: [
      'Entras con tu email, respondes unas pocas preguntas y amble se pone a buscar. Te avisará en cuanto encuentre las primeras ofertas que encajen contigo.',
      'Es una beta y lo que me cuentes la cambia. Para darme feedback: en la app, el botón «Feedback» (abajo a la derecha, o en el menú); o, si conectas WhatsApp, escríbele a amble por ahí y me llega. También puedes responder a este email: lo leo yo.',
      'Tus datos personales solo se usan para encontrar las ofertas que encajan contigo: no los vendemos ni los usamos para nada más, y los tratamos conforme al RGPD. Desde la app, en «Tus datos», puedes descargarlos o borrar tu cuenta cuando quieras. Todo el detalle en amble.fyi/es/privacy.',
      'El enlace es solo para ti.',
    ],
    signature: ['Gracias por estar desde el principio,', 'Borja'],
    footer: 'Recibes este email porque te apuntaste a la lista de espera de amble en amble.fyi.',
  }),
  en: (link) => ({
    lang: 'en',
    subject: 'Your place in the amble beta is ready',
    preheader: 'Your link to come in, just for you.',
    intro: [
      'Hi,',
      'You joined the amble waitlist, and there’s a place for you in the beta now :)',
      'amble is an agent that looks for work on your behalf: it understands what you’ve done, reads the offers and brings you only the ones that really fit.',
    ],
    button: { label: 'Come into amble', href: link },
    fallback: 'If the button doesn’t work, paste this link into your browser:',
    outro: [
      'You sign in with your email, answer a few questions and amble starts looking. It’ll let you know as soon as it finds the first offers that fit you.',
      'It’s a beta, and what you tell me changes it. To give feedback: in the app, the “Feedback” button (bottom right, or in the menu); or, once you connect WhatsApp, write to amble there and it reaches me. You can also reply to this email: I read every one.',
      'Your personal data is only used to find the offers that fit you: we don’t sell it or use it for anything else, and we handle it under the GDPR. In the app, under “Your data”, you can download it or delete your account at any time. The details are at amble.fyi/privacy.',
      'The link is just for you.',
    ],
    signature: ['Thanks for being here from the start,', 'Borja'],
    footer: 'You’re getting this because you joined the amble waitlist at amble.fyi.',
  }),
}

export function renderInviteEmail(locale: Locale, link: string): { subject: string; text: string; html: string } {
  const letter = copy[locale](link)
  return { subject: letter.subject, text: renderLetterText(letter), html: renderLetterHtml(letter) }
}

// The idempotency key is the invitation's: a retried request, or two clicks
// at once, never sends a second letter for the same invitation.
export async function sendInviteEmail(params: { to: string; locale: Locale; link: string; idempotencyKey: string }): Promise<void> {
  const { subject, text, html } = renderInviteEmail(params.locale, params.link)
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is not set: the invitation email cannot be sent.')
    console.info(`[amble] invitation email to ${params.to} (${params.locale}): ${subject}\n${text}`)
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': params.idempotencyKey },
    body: JSON.stringify({ from: FROM, to: [params.to], reply_to: REPLY_TO, subject, text, html }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend refused the invitation email (${response.status}): ${detail.slice(0, 200)}`)
  }
}
