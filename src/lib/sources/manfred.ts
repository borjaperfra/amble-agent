/**
 * Offers, arriving.
 *
 * The listening screen has been saying "nothing is arriving yet" honestly
 * for a week. This is the first thing that arrives: Manfred publishes
 * `sitemap-offers.xml` and allows everything in `robots.txt`, and every
 * offer page carries the whole posting as JSON in `__NEXT_DATA__` — salary,
 * remote share, locations, requirements, the lot. No key, no scraping of
 * rendered HTML, no private endpoint. (There is one, `offer-filter`, and it
 * wants a Manfredite token; this does not touch it.)
 *
 * Parsing is pure and lives here so it can be tested against a saved page.
 * Fetching is polite by construction: one request at a time, with a pause
 * between them, because a public sitemap is an invitation to read and not an
 * invitation to hammer.
 */

import { WORK_MODELS, type OpportunityRubric, type WorkModel } from '@/domains/opportunity/types'

export const MANFRED_BASE = 'https://www.getmanfred.com'
export const MANFRED_SITEMAP = `${MANFRED_BASE}/sitemap-offers.xml`

export interface ManfredOffer {
  /** `manfred:8476`. Stable across syncs, which is what stops duplicates. */
  sourceRef: string
  id: number
  slug: string
  title: string
  company: string
  url: string
  /** Euros a year, not the thousands the feed stores. */
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  /** 0 to 100. Manfred sells this as a percentage, not a mode. */
  remotePercent: number | null
  locations: string[]
  equity: string | null
  active: boolean
  updatedAt: string | null
  /** The posting as a person would read it, which is what gets assessed. */
  rawText: string
}

// ─── The sitemap ──────────────────────────────────────────────────────────

export function offerUrls(sitemapXml: string): string[] {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].trim())
    .filter((url) => /\/ofertas-empleo\/\d+\//.test(url))
}

// ─── One offer page ───────────────────────────────────────────────────────

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/**
 * The feed stores money in thousands — 35 means 35.000 — and a field that is
 * literally zero means "not stated" rather than "unpaid".
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

function itemsOf(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asText(typeof entry === 'string' ? entry : asRecord(entry).item))
    .filter((text): text is string => text !== null)
}

function locationsOf(summary: unknown): string[] {
  const value = asRecord(summary)
  return [...asArray(value.trimmedCities), ...asArray(value.extraCities)]
    .map((city) => asText(city))
    .filter((city): city is string => city !== null)
}

function equityOf(offer: Json): string | null {
  const low = offer.equityInf
  const high = offer.equitySup
  if (typeof low !== 'number' && typeof high !== 'number') return null
  if (typeof low === 'number' && typeof high === 'number' && low === 0 && high === 0) return null
  return [low, high]
    .filter((value): value is number => typeof value === 'number')
    .map((value) => `${value}%`)
    .join(' – ')
}

/** Pull the page's own data island out, which is where the posting really is. */
export function extractNextData(html: string): Json | null {
  const match = /id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as Json
  } catch {
    return null
  }
}

export function parseOfferPage(html: string): ManfredOffer | null {
  const data = extractNextData(html)
  if (!data) return null
  const offer = asRecord(asRecord(asRecord(data.props).pageProps).offer)
  const id = typeof offer.id === 'number' ? offer.id : null
  const title = asText(offer.title)
  const company = asText(offer.company)
  if (id === null || !title || !company) return null

  const path = asText(offer.url) ?? `/${id}`
  return {
    sourceRef: `manfred:${id}`,
    id,
    slug: asText(offer.slug) ?? String(id),
    title,
    company,
    url: `${MANFRED_BASE}/ofertas-empleo${path.startsWith('/') ? path : `/${path}`}`,
    salaryMin: annualSalary(offer.salaryMin),
    salaryMax: annualSalary(offer.salaryMax),
    currency: currencyOf(offer.currency),
    remotePercent: typeof offer.remote === 'number' ? offer.remote : null,
    locations: locationsOf(offer.locationsSummary),
    equity: equityOf(offer),
    active: offer.active !== false && offer.status !== 'CLOSED',
    updatedAt: asText(offer.updatedAt),
    rawText: composeRawText(offer),
  }
}

/**
 * The sections, back into one posting.
 *
 * Deliberately not a summary: the rubric stage reads this and decides what
 * the job actually requires, and summarising first would mean the model
 * assesses somebody against our paraphrase. The facts block at the top is
 * the exception, and it only restates fields the feed gives as numbers so
 * that "40% remote" survives as words.
 */
export function composeRawText(offerData: unknown): string {
  const offer = asRecord(offerData)
  const hero = asRecord(offer.heroSectionData)
  const requirements = asRecord(offer.requirementsSectionData)
  const skills = asRecord(offer.skillsSectionData)
  const how = asRecord(offer.howSectionData)
  const when = asRecord(offer.whenSectionData)
  const where = asRecord(offer.whereSectionData)
  const team = asRecord(offer.teamSectionData)
  const terms = asRecord(offer.offerSectionData)

  const out: string[] = []
  const section = (heading: string, ...body: (string | null | undefined)[]) => {
    const lines = body.filter((line): line is string => Boolean(line && line.trim()))
    if (lines.length === 0) return
    out.push(`## ${heading}`, ...lines, '')
  }

  const salaryMin = annualSalary(offer.salaryMin)
  const salaryMax = annualSalary(offer.salaryMax)
  const currency = currencyOf(offer.currency) ?? 'EUR'
  const remote = typeof offer.remote === 'number' ? offer.remote : null
  const locations = locationsOf(offer.locationsSummary)

  const facts: string[] = []
  if (salaryMin || salaryMax) {
    const range = [salaryMin, salaryMax]
      .filter((value): value is number => value !== null)
      .map((value) => value.toLocaleString('es-ES'))
      .join(' – ')
    facts.push(`Salary: ${range} ${currency} per year.`)
  } else {
    facts.push('Salary: not stated.')
  }
  const equity = equityOf(offer)
  facts.push(equity ? `Equity: ${equity}.` : 'Equity: not mentioned.')
  if (remote !== null) {
    facts.push(
      remote >= 100
        ? 'Work: fully remote.'
        : remote <= 0
          ? 'Work: fully on site.'
          : `Work: ${remote}% remote, the rest on site.`,
    )
  }
  if (locations.length > 0) facts.push(`Based in: ${locations.join(', ')}.`)
  const badges = itemsOf(offer.badges)
  if (badges.length > 0) facts.push(`The company describes itself as: ${badges.join(', ')}.`)

  out.push(`# ${asText(offer.title) ?? 'Role'} — ${asText(offer.company) ?? 'Company'}`, '')
  section('The facts as posted', ...facts)
  section('About the role', asText(hero.jobDescription))
  section(
    'What you would do',
    asText(requirements.requirementsIntro),
    ...itemsOf(requirements.responsabilities).map((item) => `- ${item}`),
  )
  section(
    'What they are looking for',
    asText(skills.intro),
    ...itemsOf(skills.skills).map((item) => `- ${item}`),
    ...itemsOf(skills.softSkills).map((item) => `- ${item}`),
  )
  section('How they work', asText(how.howIntro), ...itemsOf(how.howItems).map((item) => `- ${item}`))
  section(
    'Hours and conditions',
    asText(when.whenIntro),
    ...asArray(when.highlights)
      .map((entry) => {
        const highlight = asRecord(entry)
        const title = asText(highlight.title)
        const value = asText(highlight.value)
        return title && value ? `- ${title}: ${value}` : null
      })
      .filter((line): line is string => line !== null),
  )
  section('Where', asText(where.jobInfo))
  section('The team', asText(team.teamInfo), asText(team.membersInfo))
  section('What they offer', asText(terms.offerInfo))

  // The rubric prompt carries this whole thing, and a posting that runs to
  // twenty thousand characters is mostly company prose by that point.
  return out.join('\n').trim().slice(0, 14_000)
}

// ─── What can be decided before spending anything ─────────────────────────

export function workModelFor(remotePercent: number | null): WorkModel | null {
  if (remotePercent === null) return null
  if (remotePercent >= 100) return WORK_MODELS[2]
  if (remotePercent <= 0) return WORK_MODELS[0]
  return WORK_MODELS[1]
}

/**
 * What the feed already tells us, in the shape the domain rules read.
 *
 * This is not the rubric — that one is the model's reading of the posting,
 * and it still runs. This is the part that can be checked for free, so that
 * an offer paying half the floor never costs a model call at all. With
 * sixteen hundred offers in the sitemap and a minute of reasoning each, the
 * difference between screening first and not is a day of compute.
 */
export function rubricFromFeed(offer: ManfredOffer): OpportunityRubric {
  return {
    roleScope: offer.title,
    seniority: null,
    companyStage: null,
    industry: null,
    location: offer.locations[0] ?? null,
    workModel: workModelFor(offer.remotePercent),
    compensation:
      offer.salaryMin || offer.salaryMax
        ? {
            min: offer.salaryMin,
            max: offer.salaryMax,
            currency: offer.currency,
            stated: null,
          }
        : null,
    equity: offer.equity,
    environment: [],
    requirements: [],
    preferences: [],
    unknowns: [],
  }
}

// ─── Fetching ─────────────────────────────────────────────────────────────

async function get(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      // Say who this is. A feed that is public still deserves to know who is
      // reading it, and an operator who wants us gone should be able to.
      'User-Agent': 'Amble/0.1 (personal job-matching experiment; +https://github.com/)',
      Accept: 'text/html,application/xhtml+xml,application/xml',
    },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.text()
}

export async function fetchOfferUrls(): Promise<string[]> {
  return offerUrls(await get(MANFRED_SITEMAP))
}

export async function fetchOffer(url: string): Promise<ManfredOffer | null> {
  const offer = parseOfferPage(await get(url))
  return offer
}
