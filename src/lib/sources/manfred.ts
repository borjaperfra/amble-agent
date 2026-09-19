/**
 * Offers, arriving.
 *
 * The listening screen said "nothing is arriving yet" honestly for a week.
 * This is the first thing that arrives, and it arrives through Manfred's own
 * public API — the one their offers page uses:
 *
 *   GET /api/v2/public/offers?onlyActive=true&lang=ES   every live offer
 *   GET /api/v2/public/offers/{id}?lang=ES              one, in full
 *
 * No key, no token, nothing private. (There is a `manfredite/offer-filter`
 * endpoint that wants a session; it is for somebody's saved alerts and this
 * does not touch it.)
 *
 * The shape of that first call is what shapes everything downstream. One
 * request returns every active offer with what it pays, how much of it is on
 * site and where — which is exactly what the domain can check for free. So
 * the screening happens on the list, before a single detail is downloaded,
 * and only what survives costs anything at all.
 */

import { WORK_MODELS, type OpportunityRubric, type WorkModel } from '@/domains/opportunity/types'

const API = 'https://www.getmanfred.com/api/v2/public/offers'
const SITE = 'https://www.getmanfred.com/ofertas-empleo'

/** What one call gives about every offer at once. Enough to screen it. */
export interface ManfredSummary {
  /** `manfred:8476`. Stable across syncs, which is what stops duplicates. */
  sourceRef: string
  id: number
  slug: string
  position: string
  company: string
  url: string
  /** Euros a year. The API gives whole numbers, unlike the page it renders. */
  salaryFrom: number | null
  salaryTo: number | null
  currency: string | null
  /** 0 to 100. Manfred sells this as a share, not a mode. */
  remotePercentage: number | null
  locations: string[]
  equity: string | null
  freelance: boolean
  active: boolean
  updatedAt: string | null
}

export interface ManfredOffer extends ManfredSummary {
  /** The posting as a person would read it, which is what gets assessed. */
  rawText: string
}

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/**
 * A field that is literally zero means "not stated", not "unpaid". The
 * thousands guard is belt and braces: the API answers in whole euros, the
 * page it renders answers in thousands, and taking the second literally
 * would fail somebody on every offer ever published.
 */
function annualSalary(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount < 1000 ? Math.round(amount * 1000) : Math.round(amount)
}

function currencyOf(value: unknown): string | null {
  const raw = asText(value)
  if (!raw) return null
  if (raw === '€' || /eur/i.test(raw)) return 'EUR'
  if (raw === '$' || /usd/i.test(raw)) return 'USD'
  if (raw === '£' || /gbp/i.test(raw)) return 'GBP'
  return raw.slice(0, 8).toUpperCase()
}

function equityOf(raw: Json): string | null {
  const low = typeof raw.equityInf === 'number' ? raw.equityInf : null
  const high = typeof raw.equitySup === 'number' ? raw.equitySup : null
  const values = [low, high].filter((value): value is number => value !== null && value > 0)
  return values.length > 0 ? values.map((value) => `${value}%`).join(' – ') : null
}

function strings(value: unknown): string[] {
  return asArray(value)
    .map((item) => asText(typeof item === 'string' ? item : asRecord(item).name))
    .filter((item): item is string => item !== null)
}

export function summaryFrom(raw: unknown): ManfredSummary | null {
  const offer = asRecord(raw)
  const id = typeof offer.id === 'number' ? offer.id : null
  const position = asText(offer.position)
  const company = asText(asRecord(offer.company).name)
  if (id === null || !position || !company) return null

  const slug = asText(offer.slug) ?? String(id)
  return {
    sourceRef: `manfred:${id}`,
    id,
    slug,
    position,
    company,
    url: `${SITE}/${id}/${slug}`,
    salaryFrom: annualSalary(offer.salaryFrom),
    salaryTo: annualSalary(offer.salaryTo),
    currency: currencyOf(offer.currency),
    remotePercentage: typeof offer.remotePercentage === 'number' ? offer.remotePercentage : null,
    locations: strings(offer.locations),
    equity: equityOf(offer),
    freelance: offer.isFreelance === true,
    active: offer.status !== 'CLOSED' && offer.status !== 'CANCELLED',
    updatedAt: asText(offer.updatedAt),
  }
}

// ─── The posting, as words ────────────────────────────────────────────────

/** The facts the feed gives as numbers, said in words so a reader keeps them. */
function factsFor(summary: ManfredSummary, detail: Json = {}): string[] {
  const facts: string[] = []
  const currency = summary.currency ?? 'EUR'

  if (summary.salaryFrom || summary.salaryTo) {
    const range = [summary.salaryFrom, summary.salaryTo]
      .filter((value): value is number => value !== null)
      .map((value) => value.toLocaleString('es-ES'))
      .join(' – ')
    facts.push(`Salary: ${range} ${currency} per year.`)
  } else if (summary.freelance) {
    const from = typeof detail.feeRateFrom === 'number' ? detail.feeRateFrom : null
    const to = typeof detail.feeRateTo === 'number' ? detail.feeRateTo : null
    facts.push(
      from || to
        ? `Freelance, charged by the hour: ${[from, to].filter(Boolean).join(' – ')} ${currency}.`
        : 'Freelance. The rate is not stated.',
    )
  } else {
    facts.push('Salary: not stated.')
  }

  facts.push(summary.equity ? `Equity: ${summary.equity}.` : 'Equity: not mentioned.')

  if (summary.remotePercentage !== null) {
    facts.push(
      summary.remotePercentage >= 100
        ? 'Work: fully remote.'
        : summary.remotePercentage <= 0
          ? 'Work: fully on site.'
          : `Work: ${summary.remotePercentage}% remote, the rest on site.`,
    )
  }
  if (summary.locations.length > 0) facts.push(`Based in: ${summary.locations.join('; ')}.`)

  const languages = asArray(detail.languages)
    .map((entry) => {
      const language = asRecord(entry)
      const name = asText(language.name)
      const level = asText(language.level)
      return name ? `${name}${level ? ` (${level})` : ''}` : null
    })
    .filter((line): line is string => line !== null)
  if (languages.length > 0) facts.push(`Languages: ${languages.join(', ')}.`)

  const day = asRecord(detail.workingDayInfo)
  const dayParts: string[] = []
  if (day.isFullTime === true) dayParts.push('full time')
  if (day.hasFlexTime === true) dayParts.push('flexible hours')
  if (typeof day.annualHolidays === 'number' && day.annualHolidays > 0) {
    dayParts.push(`${day.annualHolidays} days of holiday`)
  }
  if (dayParts.length > 0) facts.push(`Working day: ${dayParts.join(', ')}.`)

  const highlights = strings(detail.highlights ?? [])
  if (highlights.length > 0) {
    facts.push(`The company describes itself as: ${highlights.join(', ')}.`)
  }

  return facts
}

/**
 * The offer, put back together for the rubric stage.
 *
 * Deliberately not a summary: the rubric decides what the job requires, and
 * summarising first would mean assessing somebody against our paraphrase.
 * The one thing added is the facts block, which only restates numbers the
 * feed already gave — so "40% remote" survives as something readable.
 */
export function composeRawText(summary: ManfredSummary, rawDetail: unknown): string {
  const detail = asRecord(rawDetail)
  const out: string[] = [`# ${summary.position} — ${summary.company}`, '']

  const section = (heading: string, ...body: (string | null)[]) => {
    const lines = body.filter((line): line is string => Boolean(line && line.trim()))
    if (lines.length === 0) return
    out.push(`## ${heading}`, ...lines, '')
  }

  const bullets = (value: unknown) =>
    asArray(value)
      .map((item) => asText(typeof item === 'string' ? item : asRecord(item).name))
      .filter((item): item is string => item !== null)
      .map((item) => `- ${item}`)

  // Wanted, nice to have, and how deep — the sections the feed already
  // grades. This is the closest thing the source has to a rubric, so it
  // should reach the stage that builds one.
  const techs = asArray(detail.techs)
    .map((entry) => {
      const tech = asRecord(entry)
      const name = asText(tech.name)
      if (!name) return null
      const section = asText(tech.section)
      const level = asText(tech.level)
      const notes = [
        section === 'MUST' ? 'must have' : section === 'SHOULD' ? 'should have' : 'nice to have',
        level ? level.toLowerCase() : null,
      ].filter(Boolean)
      return `- ${name} (${notes.join(', ')})`
    })
    .filter((line): line is string => line !== null)

  section('The facts as posted', ...factsFor(summary, detail))
  section('About the role', asText(detail.introduction))
  section('What you would do', asText(detail.whatWillYouDo), ...bullets(detail.responsibilities))
  section('How they work', asText(detail.howWillYouDoIt))
  section(
    'What they are looking for',
    asText(detail.whatTheyAskFor),
    ...techs,
    ...bullets(detail.softSkills),
  )
  section('Hours and conditions', asText(detail.whenWillDoIt))
  section('Where', asText(detail.whereWillDoIt))
  section('The team', asText(detail.whoWillDoItWith))
  section('What they offer', asText(detail.whatOffering), ...bullets(detail.perks))
  section(
    'The first months',
    asText(detail.inOneMonth),
    asText(detail.inThreeMonths),
    asText(detail.inSixMonths),
  )

  // The rubric prompt carries all of this, and past about fourteen thousand
  // characters a posting is mostly company prose.
  return out.join('\n').trim().slice(0, 14_000)
}

/**
 * What is known about an offer that never got past the free screen.
 *
 * It is still written down — the reason it was dropped is the interesting
 * part — but nothing was downloaded for it, so this is all there is.
 */
export function summaryText(summary: ManfredSummary): string {
  return [
    `# ${summary.position} — ${summary.company}`,
    '',
    '## The facts as posted',
    ...factsFor(summary),
    '',
    'Not read any further: it failed on something the candidate made a condition.',
  ].join('\n')
}

// ─── What can be decided before spending anything ─────────────────────────

export function workModelFor(remotePercentage: number | null): WorkModel | null {
  if (remotePercentage === null) return null
  if (remotePercentage >= 100) return WORK_MODELS[2]
  if (remotePercentage <= 0) return WORK_MODELS[0]
  return WORK_MODELS[1]
}

/**
 * What the list already tells us, in the shape the domain rules read.
 *
 * This is not the rubric — that one is the model's reading of the posting,
 * and it still runs on whatever survives. This is only the part that can be
 * checked for free, from one request, before anything is downloaded.
 */
export function rubricFromFeed(summary: ManfredSummary): OpportunityRubric {
  return {
    roleScope: summary.position,
    seniority: null,
    companyStage: null,
    industry: null,
    location: summary.locations[0] ?? null,
    workModel: workModelFor(summary.remotePercentage),
    compensation:
      summary.salaryFrom || summary.salaryTo
        ? {
            min: summary.salaryFrom,
            max: summary.salaryTo,
            currency: summary.currency,
            stated: null,
          }
        : null,
    equity: summary.equity,
    environment: [],
    requirements: [],
    preferences: [],
    unknowns: [],
  }
}

// ─── Fetching ─────────────────────────────────────────────────────────────

async function get(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      // Say who this is. A public API still deserves to know who is reading
      // it, and an operator who wants us gone should be able to tell.
      'User-Agent': 'Amble/0.1 (personal job-matching experiment)',
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

/** Every live offer, in one request. ~17 of them; 1,651 with the history. */
export async function fetchOfferSummaries(language = 'ES'): Promise<ManfredSummary[]> {
  const raw = await get(`${API}?onlyActive=true&lang=${encodeURIComponent(language)}`)
  return asArray(raw)
    .map((entry) => summaryFrom(entry))
    .filter((offer): offer is ManfredSummary => offer !== null)
}

export async function fetchOfferDetail(id: number, language = 'ES'): Promise<unknown> {
  return get(`${API}/${id}?lang=${encodeURIComponent(language)}`)
}

export async function fetchOffer(summary: ManfredSummary, language = 'ES'): Promise<ManfredOffer> {
  return { ...summary, rawText: composeRawText(summary, await fetchOfferDetail(summary.id, language)) }
}
