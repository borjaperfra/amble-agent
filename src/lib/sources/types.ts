/**
 * What a source of offers has to produce, whatever it is underneath.
 *
 * Manfred, an ATS job board, and one day a company posting directly all
 * arrive differently and none of the differences should reach the pipeline.
 * What it needs is the same four things every time: who and what, enough
 * structured fact to be screened for free, the posting itself, and a
 * reference stable enough that tomorrow's sync knows it has seen this one.
 *
 * The screening is why the structured half exists separately from the
 * posting. Holding an offer against what somebody said they will not do
 * costs nothing when the feed states it as a number, and costs a minute of
 * reasoning when it has to be read out of prose.
 */

import type { OpportunityRubric, WorkModel } from '@/domains/opportunity/types'

export interface FeedOffer {
  /** `manfred:8476`, `greenhouse:vercel:6136160004`. Unique and stable. */
  sourceRef: string
  source: string
  company: string
  role: string
  url: string
  /** Whole units a year, never thousands. Null when the feed did not say. */
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  /**
   * Only when the feed states it as something structured. A guess read out
   * of "Hybrid - London" is not a fact, and the rubric stage is where prose
   * gets read.
   */
  workModel: WorkModel | null
  locations: string[]
  equity: string | null
  /** The feed's own grouping, not our reading of the title. */
  department: string | null
  active: boolean
  /** The source's own record, kept so the adapter can build the posting. */
  raw: unknown
}

export interface FeedAdapter {
  /** Goes into `sourceRef` and into the audit trail. */
  readonly source: string
  /** Everything currently open. One request where the feed allows it. */
  list(): Promise<FeedOffer[]>
  /** The posting in full. Free when the listing already carried it. */
  rawText(offer: FeedOffer): Promise<string>
}

// ─── Shared reading ───────────────────────────────────────────────────────

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export const asText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/**
 * A field that is literally zero means "not stated", not "unpaid". The
 * thousands guard is belt and braces: some feeds answer in whole euros and
 * some in thousands, and taking the second literally would fail somebody on
 * every offer they ever published.
 */
export function annualSalary(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount < 1000 ? Math.round(amount * 1000) : Math.round(amount)
}

export function currencyOf(value: unknown): string | null {
  const raw = asText(value)
  if (!raw) return null
  if (raw === '€' || /eur/i.test(raw)) return 'EUR'
  if (raw === '$' || /usd/i.test(raw)) return 'USD'
  if (raw === '£' || /gbp/i.test(raw)) return 'GBP'
  return raw.slice(0, 8).toUpperCase()
}

/** The numbers a feed gives, said in words so the rubric stage keeps them. */
export function factsBlock(offer: FeedOffer, extra: string[] = []): string[] {
  const facts: string[] = []
  const currency = offer.currency ?? 'EUR'

  if (offer.salaryMin || offer.salaryMax) {
    const range = [offer.salaryMin, offer.salaryMax]
      .filter((value): value is number => value !== null)
      .map((value) => value.toLocaleString('es-ES'))
      .join(' – ')
    facts.push(`Salary: ${range} ${currency} per year.`)
  } else {
    facts.push('Salary: not stated.')
  }

  facts.push(offer.equity ? `Equity: ${offer.equity}.` : 'Equity: not mentioned.')

  if (offer.workModel) {
    facts.push(
      offer.workModel === 'remote'
        ? 'Work: fully remote.'
        : offer.workModel === 'onsite'
          ? 'Work: fully on site.'
          : 'Work: hybrid.',
    )
  }
  if (offer.locations.length > 0) facts.push(`Based in: ${offer.locations.join('; ')}.`)
  if (offer.department) facts.push(`Team: ${offer.department}.`)

  return [...facts, ...extra]
}

/**
 * What the listing already tells us, in the shape the domain rules read.
 *
 * This is not the rubric — that one is the model's reading of the posting,
 * and it still runs on whatever survives. This is only the part that can be
 * checked for nothing, before anything is downloaded or reasoned about.
 */
export function rubricFromFeed(offer: FeedOffer): OpportunityRubric {
  return {
    roleScope: offer.role,
    seniority: null,
    companyStage: null,
    industry: null,
    location: offer.locations[0] ?? null,
    workModel: offer.workModel,
    compensation:
      offer.salaryMin || offer.salaryMax
        ? { min: offer.salaryMin, max: offer.salaryMax, currency: offer.currency, stated: null }
        : null,
    equity: offer.equity,
    environment: [],
    requirements: [],
    preferences: [],
    unknowns: [],
  }
}

/** What is known about an offer that never got past the free screen. */
export function screenedText(offer: FeedOffer): string {
  return [
    `# ${offer.role} — ${offer.company}`,
    '',
    '## The facts as posted',
    ...factsBlock(offer),
    '',
    'Not read any further: it failed on something the candidate made a condition.',
  ].join('\n')
}

/** One request at a time, and say who is asking. */
export async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Amble/0.1 (personal job-matching experiment)',
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}
