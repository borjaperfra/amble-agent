import type { AgentAnswer, AgentContext } from '../src/lib/whatsapp/agent'

// What a case of evals/agent expects, and how a reply is judged against it:
// used by the runner (eval-agent.ts) and by the check that the cases are
// well formed (tests/agent-evals.ts), which needs no model.

export const APP = 'https://app.amble.fyi'

// Someone who has used amble for a few weeks: a product manager in Madrid,
// on WhatsApp, with offers sent, one followed, some waiting in the app.
export function base(today: string, appPages: AgentContext['appPages']): AgentContext {
  return {
    channel: 'WhatsApp',
    chatApps: [
      { app: 'whatsapp', connected: true },
      { app: 'telegram', connected: false },
    ],
    today,
    remindersAhead: [],
    pendingInterviewQuestion: null,
    mapGaps: [{ id: 'unc_sql', about: 'SQL y análisis de datos', question: '¿Has escrito tú las consultas, o las pedías a otra persona?' }],
    companiesExcluded: [],
    name: 'Alex',
    language: 'Spanish',
    listeningFor: {
      said: ['Product Manager en una empresa de producto', 'Madrid o remoto desde España', 'Al menos 60.000 € brutos al año'],
      rulesOut: [{ id: 'rp_remote', label: 'Solo remoto o Madrid', statement: 'Nada presencial fuera de Madrid' }],
      pay: [{ id: 'rp_pay', label: 'Mínimo 60.000 €', statement: 'Al menos 60.000 € brutos al año' }],
      weighs: [{ id: 'rp_small', label: 'Equipos pequeños', statement: 'Prefiero equipos pequeños' }],
      notFilteringOn: [],
    },
    waitingForWhyItDoesNotFit: null,
    pendingChange: null,
    searchPaused: false,
    searchPausedSince: null,
    whatYouReadForThem: {
      rereadingWhatCameIn: false,
      readThisWeek: 412,
      worthItThisWeek: 6,
      inTheAppToAnswer: { fits: 4, adjacent: 2 },
      inTheAppToAnswerList: [
        { company: 'Canonical', title: 'Product Manager, Ubuntu Pro', where: 'Remoto · remote', why: 'Producto B2B con equipos distribuidos, como el que llevaste en Cabify.' },
        { company: 'OpenAI', title: 'Product Manager, API', where: 'Londres · hybrid', why: 'Producto para desarrolladores, cercano a lo que hiciste con la API de pagos.' },
        { company: 'Tether', title: 'Product Engineering Lead, Keet', where: 'Remote', why: 'Producto de consumo con equipo pequeño.' },
        { company: 'Factorial', title: 'Senior Product Manager, Payroll', where: 'Barcelona · hybrid', why: 'Producto de nóminas, cerca de tu experiencia en pagos.' },
      ],
      setAsideByReason: { 'rule: Solo remoto o Madrid': 180, pay_below_floor: 95, role: 120 },
    },
    offersTheyMention: [],
    capabilities: [
      { name: 'Gestión de producto B2B', assessment: 'STRONG' },
      { name: 'Pagos y facturación', assessment: 'MODERATE' },
      { name: 'Análisis de datos con SQL', assessment: 'UNCERTAIN' },
    ],
    experience: ['Product Manager en Cabify (2021 – hoy): producto de pagos para empresas', 'Product Owner en una consultora (2018 – 2021)'],
    stillUncertain: ['Si el análisis de datos lo hacía en persona o con el equipo de datos'],
    offersSentOnWhatsApp: [
      {
        company: 'Pigment',
        title: 'Senior Product Manager, Integrations',
        where: 'Madrid · hybrid',
        salary: '65.000 – 80.000 €',
        sentAt: today.slice(0, 10),
        theirAnswer: null,
        why: ['Producto B2B de planificación financiera', 'Equipo de integraciones pequeño'],
        considerAlso: 'Piden experiencia con APIs públicas.',
        offerDoesNotSay: ['Días de oficina'],
        url: 'https://jobs.ashbyhq.com/pigment/1234',
      },
      {
        company: 'Affirm',
        title: 'Product Manager, Merchant Payments',
        where: 'Remote (Spain)',
        salary: null,
        sentAt: today.slice(0, 10),
        theirAnswer: 'interested',
        why: ['Pagos para comercios, como en Cabify'],
        considerAlso: null,
        offerDoesNotSay: ['Salario'],
        url: 'https://job-boards.greenhouse.io/affirm/jobs/5678',
      },
    ],
    following: [{ company: 'Factorial', title: 'Senior Product Manager, Payroll', state: 'they applied', since: today.slice(0, 10), whatTheySaidLater: null, closed: false }],
    conversation: [],
    appPages,
    notAvailableNow: [],
  }
}

export interface Expect {
  intent?: string | string[]
  action?: string | null | (string | null)[]
  actionHas?: Record<string, unknown>
  preference?: boolean
  forward?: boolean
  answersInterview?: boolean
  reasonItDoesNotFit?: boolean
  reminders?: number
  replyIncludes?: string[]
  replyIncludesAny?: string[]
}

export interface Case {
  id: string
  message: string
  context?: Record<string, unknown>
  expect: Expect
  forbid?: string[]
  allow?: string[]
}

export interface EvalFile {
  issue: number | null
  feedback: string
  cases: Case[]
}

export type Json = Record<string, unknown>

export function merge(into: Json, over: Json): Json {
  const out: Json = { ...into }
  for (const [key, value] of Object.entries(over)) {
    const was = out[key]
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && was && typeof was === 'object' && !Array.isArray(was) ? merge(was as Json, value as Json) : value
  }
  return out
}

export function pattern(text: string): RegExp {
  const regex = text.match(/^\/([\s\S]+)\/([imsu]*)$/)
  return regex ? new RegExp(regex[1], regex[2].includes('i') ? regex[2] : `${regex[2]}i`) : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

// What every reply must not have.
export const ALWAYS: Record<string, RegExp> = {
  // Percentages read as a score (#41): amble does not grade people.
  percent: /%/,
  // The words of WHAT YOU KNOW, amble's own (the prompt's Style).
  internal: /\b(posting|real floor|floor|evidence|filter|hard_filter|listeningFor|appPages|notAvailableNow|mapGaps|rulesOut|offersTheyMention)\b/i,
  // A word that marks their gender (the prompt's Style).
  gender:
    /\b(estás|estar|sientes|te veo|te noto|quedas?|sigues)\s+(muy\s+|tan\s+|más\s+|algo\s+)?(interesad|cansad|agobiad|motivad|encantad|content|frustrad|desanimad|segur|preparad|list|sol|perdid|quemad|hart)[oa]s?\b|\b(tú|ti|contigo)\s+mism[oa]\b|\bbienvenid[oa]\b|\binteresad[oa]\b/i,
}

export function check(item: Case, answer: AgentAnswer, context: AgentContext, promisesWithoutKeeping: (answer: AgentAnswer) => boolean): string[] {
  const wrong: string[] = []
  const e = item.expect
  const reply = answer.reply
  const type = answer.action?.type ?? null
  if (e.intent !== undefined && ![e.intent].flat().includes(answer.intent)) wrong.push(`intent ${answer.intent}, expected ${[e.intent].flat().join('|')}`)
  if (e.action !== undefined && !(Array.isArray(e.action) ? e.action : [e.action]).includes(type)) wrong.push(`action ${type}, expected ${[e.action].flat().map(String).join('|')}`)
  if (e.actionHas) {
    for (const [key, value] of Object.entries(e.actionHas)) {
      const got = (answer.action as Record<string, unknown> | null)?.[key]
      const same = typeof value === 'string' && typeof got === 'string' ? got.toLowerCase().includes(value.toLowerCase()) : got === value
      if (!same) wrong.push(`action.${key} ${JSON.stringify(got)}, expected ${JSON.stringify(value)}`)
    }
  }
  if (e.preference !== undefined && (answer.preference !== null) !== e.preference) wrong.push(e.preference ? 'no preference proposed' : 'a preference proposed')
  if (e.forward !== undefined && answer.forward !== e.forward) wrong.push(`forward ${answer.forward}`)
  if (e.answersInterview !== undefined && answer.answersInterview !== e.answersInterview) wrong.push(`answersInterview ${answer.answersInterview}`)
  if (e.reasonItDoesNotFit !== undefined && (answer.reasonItDoesNotFit !== null) !== e.reasonItDoesNotFit) wrong.push(`reasonItDoesNotFit ${JSON.stringify(answer.reasonItDoesNotFit)}`)
  if (e.reminders !== undefined && answer.reminders.length < e.reminders) wrong.push(`${answer.reminders.length} reminders, expected at least ${e.reminders}`)
  for (const words of e.replyIncludes ?? []) if (!pattern(words).test(reply)) wrong.push(`reply lacks «${words}»`)
  if (e.replyIncludesAny && !e.replyIncludesAny.some((words) => pattern(words).test(reply))) wrong.push(`reply has none of «${e.replyIncludesAny.join('», «')}»`)
  for (const words of item.forbid ?? []) {
    const found = reply.match(pattern(words))
    if (found) wrong.push(`reply says «${found[0]}»`)
  }
  const allow = new Set(item.allow ?? [])
  for (const [name, regex] of Object.entries(ALWAYS)) {
    if (allow.has(name)) continue
    const found = reply.match(regex)
    if (found) wrong.push(`${name}: «${found[0]}»`)
  }
  // A promise to keep something with nothing that keeps it, after the second ask (#44).
  if (promisesWithoutKeeping(answer)) wrong.push('promises to keep something and sets nothing that does')
  // Only links it was given (keepKnownLinks would cut any other).
  if (!allow.has('links')) {
    const known = [APP, 'https://amble.fyi', ...context.offersSentOnWhatsApp.map((offer) => offer.url ?? '')].filter(Boolean)
    for (const url of reply.match(/https?:\/\/[^\s)>\]]+/g) ?? []) if (!known.some((start) => url.startsWith(start))) wrong.push(`links: «${url}» made up`)
  }
  return wrong
}
