/**
 * Manfred, through its own public API — the one their offers page calls:
 *
 *   GET /api/v2/public/offers?onlyActive=true&lang=ES   every live offer
 *   GET /api/v2/public/offers/{id}?lang=ES              one, in full
 *
 * No key, nothing private. (There is a `manfredite/offer-filter` endpoint
 * that wants a session; it is for somebody's saved alerts and this does not
 * touch it.)
 *
 * The shape of that first call is what shapes the sync. One request returns
 * every live offer with what it pays, how much of it is on site and where —
 * exactly what the domain can check for free — so the screening happens on
 * the list and only survivors are fetched in full. Unlike the ATS boards,
 * Manfred states pay as numbers, which is what makes the free screen worth
 * anything here.
 */

import type { WorkModel } from '@/domains/opportunity/types'
import {
  annualSalary,
  asArray,
  asRecord,
  asText,
  currencyOf,
  factsBlock,
  getJson,
  type FeedAdapter,
  type FeedOffer,
} from './types'

const API = 'https://www.getmanfred.com/api/v2/public/offers'
const SITE = 'https://www.getmanfred.com/ofertas-empleo'

export const MANFRED_SOURCE = 'manfred'

/** Manfred sells presence as a share of the week, not as a mode. */
export function workModelFor(remotePercentage: number | null): WorkModel | null {
  if (remotePercentage === null) return null
  if (remotePercentage >= 100) return 'remote'
  if (remotePercentage <= 0) return 'onsite'
  return 'hybrid'
}

function equityOf(raw: Record<string, unknown>): string | null {
  const values = [raw.equityInf, raw.equitySup].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  return values.length > 0 ? values.map((value) => `${value}%`).join(' – ') : null
}

function strings(value: unknown): string[] {
  return asArray(value)
    .map((item) => asText(typeof item === 'string' ? item : asRecord(item).name))
    .filter((item): item is string => item !== null)
}

export function offerFromListing(raw: unknown): FeedOffer | null {
  const listing = asRecord(raw)
  const id = typeof listing.id === 'number' ? listing.id : null
  const role = asText(listing.position)
  const company = asText(asRecord(listing.company).name)
  if (id === null || !role || !company) return null

  const slug = asText(listing.slug) ?? String(id)
  return {
    sourceRef: `${MANFRED_SOURCE}:${id}`,
    source: MANFRED_SOURCE,
    company,
    role,
    url: `${SITE}/${id}/${slug}`,
    salaryMin: annualSalary(listing.salaryFrom),
    salaryMax: annualSalary(listing.salaryTo),
    currency: currencyOf(listing.currency),
    workModel: workModelFor(
      typeof listing.remotePercentage === 'number' ? listing.remotePercentage : null,
    ),
    locations: strings(listing.locations),
    equity: equityOf(listing),
    department: null,
    active: listing.status !== 'CLOSED' && listing.status !== 'CANCELLED',
    raw: listing,
  }
}

/**
 * The offer, put back together for the rubric stage.
 *
 * Deliberately not a summary: the rubric decides what the job requires, and
 * summarising first would mean assessing somebody against our paraphrase.
 * The one thing added is the facts block, which only restates what the feed
 * already gave as numbers.
 */
export function composeRawText(offer: FeedOffer, rawDetail: unknown): string {
  const detail = asRecord(rawDetail)
  const out: string[] = [`# ${offer.role} — ${offer.company}`, '']

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

  const extra: string[] = []
  const languages = asArray(detail.languages)
    .map((entry) => {
      const language = asRecord(entry)
      const name = asText(language.name)
      const level = asText(language.level)
      return name ? `${name}${level ? ` (${level})` : ''}` : null
    })
    .filter((line): line is string => line !== null)
  if (languages.length > 0) extra.push(`Languages: ${languages.join(', ')}.`)

  const day = asRecord(detail.workingDayInfo)
  const dayParts: string[] = []
  if (day.isFullTime === true) dayParts.push('full time')
  if (day.hasFlexTime === true) dayParts.push('flexible hours')
  if (typeof day.annualHolidays === 'number' && day.annualHolidays > 0) {
    dayParts.push(`${day.annualHolidays} days of holiday`)
  }
  if (dayParts.length > 0) extra.push(`Working day: ${dayParts.join(', ')}.`)

  const highlights = strings(detail.highlights)
  if (highlights.length > 0) {
    extra.push(`The company describes itself as: ${highlights.join(', ')}.`)
  }

  // Wanted, nice to have, and how deep — the grading the feed already did.
  // It is the closest thing the source has to a rubric, so it should reach
  // the stage that builds one.
  const techs = asArray(detail.techs)
    .map((entry) => {
      const tech = asRecord(entry)
      const name = asText(tech.name)
      if (!name) return null
      const where = asText(tech.section)
      const level = asText(tech.level)
      const notes = [
        where === 'MUST' ? 'must have' : where === 'SHOULD' ? 'should have' : 'nice to have',
        level ? level.toLowerCase() : null,
      ].filter(Boolean)
      return `- ${name} (${notes.join(', ')})`
    })
    .filter((line): line is string => line !== null)

  section('The facts as posted', ...factsBlock(offer, extra))
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

  return out.join('\n').trim().slice(0, 14_000)
}

export function manfredAdapter(language = 'ES'): FeedAdapter {
  return {
    source: MANFRED_SOURCE,
    async list() {
      const raw = await getJson(`${API}?onlyActive=true&lang=${encodeURIComponent(language)}`)
      return asArray(raw)
        .map((entry) => offerFromListing(entry))
        .filter((offer): offer is FeedOffer => offer !== null)
    },
    async rawText(offer) {
      const id = offer.sourceRef.split(':')[1]
      const detail = await getJson(`${API}/${id}?lang=${encodeURIComponent(language)}`)
      return composeRawText(offer, detail)
    },
  }
}
