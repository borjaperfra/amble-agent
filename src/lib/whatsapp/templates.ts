import { getDb } from '../db/db'
import { candidateById } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import type { Locale } from '../i18n/locale'
import { logMessage } from './conversation'
import type { WhatsAppLink } from './link'
import { sendTemplateMessage, type TemplateDefinition, type ZernioConfig } from './zernio'

// Past the 24 hours since their last message, WhatsApp only lets amble write
// with a template Meta approved: a short line that asks, with buttons. A tap
// opens the 24 hours again, and what the template stood for follows as it
// always does (the whole offer, the question with its own buttons...). Each
// button tapped is translated into the payload the ordinary message's button
// would have carried, so one path answers both.
//
// Off until the templates are approved (AMBLE_WHATSAPP_TEMPLATES=1): before,
// a closed window keeps behaving as it did.

export type TemplateKind = 'offer' | 'followup' | 'reminder' | 'question' | 'pause'

const NAMES: Record<TemplateKind, string> = {
  // amble_oferta ("he encontrado una oferta… ¿te la enseño?") read to Meta as
  // a job scam from a new number: Meta locked the account the day it went in.
  // This one only tells them their own search has news.
  offer: 'amble_novedades',
  followup: 'amble_seguimiento',
  reminder: 'amble_recordatorio',
  question: 'amble_pregunta',
  pause: 'amble_pausa',
}

// The wording Meta reviews. A variable may not open or close the text.
const COPY: Record<Locale, Record<TemplateKind, { body: string; example: string[]; buttons: string[] }>> = {
  es: {
    offer: {
      body: 'Hola {{1}}, hay novedades en tu búsqueda de amble. ¿Te las cuento?',
      example: ['Laura'],
      buttons: ['Cuéntame', 'Ahora no'],
    },
    followup: {
      body: 'Hola {{1}}, hace unos días enviaste tu candidatura a {{2}} en {{3}}. ¿Te han dicho algo?',
      example: ['Laura', 'Head of Marketing', 'Factorial'],
      buttons: ['Me han contestado', 'Aún nada', 'Me han dicho no'],
    },
    reminder: {
      body: 'Hola {{1}}, te escribo por lo que me pediste que te recordara: {{2}}. Si quieres, lo preparamos juntos.',
      example: ['Laura', 'la entrevista de mañana con Factorial'],
      buttons: ['Vale', 'Ahora no'],
    },
    question: {
      body: 'Hola {{1}}, tengo una pregunta rápida para afinar las ofertas que te busco. ¿Tienes un minuto?',
      example: ['Laura'],
      buttons: ['Dime', 'Ahora no'],
    },
    pause: {
      body: 'Hola {{1}}, pausaste tu búsqueda hasta el {{2}}. ¿La reactivo?',
      example: ['Laura', '15 de octubre'],
      buttons: ['Sí, reactívala', 'Todavía no'],
    },
  },
  en: {
    offer: {
      body: 'Hi {{1}}, there’s news in your amble search. Shall I tell you?',
      example: ['Laura'],
      buttons: ['Tell me', 'Not now'],
    },
    followup: {
      body: 'Hi {{1}}, a few days ago you applied for {{2}} at {{3}}. Have you heard anything?',
      example: ['Laura', 'Head of Marketing', 'Factorial'],
      buttons: ['They replied', 'Nothing yet', 'They said no'],
    },
    reminder: {
      body: 'Hi {{1}}, I’m writing about what you asked me to remind you of: {{2}}. If you like, we can prepare it together.',
      example: ['Laura', 'tomorrow’s interview with Factorial'],
      buttons: ['OK', 'Not now'],
    },
    question: {
      body: 'Hi {{1}}, I have a quick question to sharpen the offers I look for. Do you have a minute?',
      example: ['Laura'],
      buttons: ['Go ahead', 'Not now'],
    },
    pause: {
      body: 'Hi {{1}}, you paused your search until {{2}}. Shall I turn it back on?',
      example: ['Laura', 'October 15'],
      buttons: ['Yes, turn it on', 'Not yet'],
    },
  },
}

// Every template, as submitted to Meta (scripts/whatsapp-templates.ts).
export function templateDefinitions(): TemplateDefinition[] {
  return (Object.keys(COPY) as Locale[]).flatMap((language) =>
    (Object.keys(NAMES) as TemplateKind[]).map((kind) => ({
      name: NAMES[kind],
      language,
      category: 'UTILITY' as const,
      ...COPY[language][kind],
    })),
  )
}

export function templatesEnabled(): boolean {
  return process.env.AMBLE_WHATSAPP_TEMPLATES === '1'
}

const HOURS_TO_TAP = 72

interface Taps {
  kind: TemplateKind
  // What each button stands for, in the template's order: the payload the
  // ordinary message would have carried; null for "not now".
  payloads: (string | null)[]
  // Their language when it was sent: the buttons' words to recognise.
  locale: Locale
  until: string
}

// The template, with what each of its buttons will mean when tapped.
export async function sendTemplate(
  config: ZernioConfig,
  link: WhatsAppLink,
  kind: TemplateKind,
  values: string[],
  payloads: (string | null)[],
  idempotencyKey: string,
): Promise<void> {
  const candidate = candidateById(link.candidate_id)
  const locale = candidateLocale(candidate)
  const name = (candidate.name ?? '').trim().split(/\s+/)[0] || (locale === 'es' ? 'hola' : 'there')
  const all = [name, ...values]
  await sendTemplateMessage(config, { phone: link.phone, name: NAMES[kind], language: locale, values: all, idempotencyKey })
  const taps: Taps = { kind, payloads, locale, until: new Date(Date.now() + HOURS_TO_TAP * 60 * 60 * 1000).toISOString() }
  getDb().prepare('UPDATE whatsapp_links SET template_taps = ? WHERE candidate_id = ?').run(JSON.stringify(taps), link.candidate_id)
  // The conversation as they read it, variables filled in.
  logMessage(link.candidate_id, 'out', all.reduce((text, value, index) => text.replace(`{{${index + 1}}}`, value), COPY[locale][kind].body))
}

// A tap on the last template's button: the payload it stands for, or the
// empty string for "not now". Null when it is not a template tap.
export function templateTap(candidateId: string, buttonPayload: string | null, text: string): string | null {
  if (!buttonPayload) return null
  const row = getDb().prepare('SELECT template_taps FROM whatsapp_links WHERE candidate_id = ?').get(candidateId) as { template_taps: string | null } | undefined
  if (!row?.template_taps) return null
  const taps = JSON.parse(row.template_taps) as Taps
  if (Date.parse(taps.until) < Date.now()) return null
  const said = (buttonPayload || text).trim().toLowerCase()
  const index = COPY[taps.locale][taps.kind].buttons.findIndex((button) => button.toLowerCase() === said)
  if (index < 0) return null
  getDb().prepare('UPDATE whatsapp_links SET template_taps = NULL WHERE candidate_id = ?').run(candidateId)
  return taps.payloads[index] ?? ''
}
