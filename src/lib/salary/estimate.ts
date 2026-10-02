import { getDb, inTransaction } from '../db/db'
import { BANDS, BANDS_VERSION, LEVEL_YEARS, SOURCES, type Band, type Place } from './bands'
import { keyOf, type OfferKey } from './map'

// What an offer that publishes no salary probably pays, read from the
// reference table (bands.ts) and never from a model: the figures are the
// sources'. It is always shown as an estimate, with where it comes from, and
// it never discards or holds an offer: only a published salary can do that.
// It can order what is shown and warn that the pay may fall short of
// someone's floor.
//
// Computed once per offer and kept with it (opportunity_salary_estimates);
// computed again only when the table or the rules change (the version).

// The rules in map.ts and here: a change to them recomputes every estimate.
const RULES_VERSION = 4
export const ESTIMATE_VERSION = `${BANDS_VERSION}.${RULES_VERSION}`

export interface SalaryEstimate {
  min: number
  max: number
  currency: 'EUR'
  source: string
  year: number
  url: string
  // The row as the source names it: the role and the experience it is for.
  role: string
  experience: string
  // Where the figure is for: the offer's city, or Spain as a whole, or (for
  // the rest of Spain, where the source only gives cities) the city of the
  // source's that pays least.
  place: Place | 'bilbao' | 'sevilla'
  // How the offer was placed in the table, for review.
  key: OfferKey
}

// Why there is none: the offer publishes its pay (in its fields or in its
// text), or the table has no row for its role, level or place.
export type NoEstimate = 'published' | 'in_text' | 'role' | 'place' | 'source' | 'level'

interface Stored {
  v: string
  estimate: SalaryEstimate | null
  none?: NoEstimate
}

// A salary written in the posting's text ("45.000 - 55.000 €", "€60k",
// "salario: 40K", "up to £70,000"): the posting publishes it, so nothing is
// estimated over it. Amounts between 15K and 500K next to a currency or a
// word about pay; "raised €50M" is not a salary.
const MONEY = /(?:[€£$]\s?\d{2,3}(?:[.,\s]\d{3}|\s?k\b))|(?:\b\d{2,3}(?:[.,\s]\d{3}|\s?k)\s?(?:€|eur\b|euros?\b|£|gbp\b|\$|usd\b))/i
const PAY_WORDS = /\b(salary|salario|salarial|compensation|compensación|compensacion|retribución|retribucion|remuneración|remuneracion|sueldo|pay range|base pay|brutos?|gross|bruto anual|per annum|al año|anual)\b/i
const PAY_AMOUNT = /\b\d{2,3}(?:[.,\s]\d{3}|\s?k)\b/i

export function salaryInText(description: string | null): boolean {
  if (!description) return false
  for (const match of description.matchAll(new RegExp(MONEY.source, 'gi'))) {
    const around = description.slice(Math.max(0, (match.index ?? 0) - 80), (match.index ?? 0) + match[0].length + 80)
    // A funding round or a turnover names millions or billions after it.
    if (/^\s*(m\b|mn\b|million|millones|bn\b|billion|b\b)/i.test(description.slice((match.index ?? 0) + match[0].length))) continue
    if (PAY_WORDS.test(around) || /\b(k|000)\s?(-|–|to|a)\s?[€£$]?\s?\d/i.test(around)) return true
  }
  // "Salario: 40-50K" without a currency sign.
  for (const match of description.matchAll(new RegExp(PAY_WORDS.source, 'gi'))) {
    const after = description.slice(match.index ?? 0, (match.index ?? 0) + 60)
    if (PAY_AMOUNT.test(after)) return true
  }
  return false
}

// How far two ranges of years of experience overlap.
function overlap(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))
}

// The row for a role at a level, for a place: the source's own for that city
// if it has one, otherwise the Spain-wide one; for the rest of Spain, the
// Spain-wide one, otherwise the least-paying city the source gives outside
// Madrid, Barcelona and Valencia. Of that row's experience brackets, the one
// that overlaps most the years the level stands for; none that overlaps, no
// estimate (a senior role is not given a junior's figure). A row the source
// gives for a level of its own ("Head of design", "CTO") is that level's,
// whatever its years, and a head of anything takes only such a row. When the offer does not say its level, the bracket
// nearest the middle of the scale, and the label says which it is.
export function bandFor(key: Pick<OfferKey, 'role' | 'level' | 'place' | 'levelFrom'>): Band | null | 'level' {
  const rows = BANDS.filter((band) => band.role === key.role)
  if (rows.length === 0) return null
  const at = (place: Band['place']) => rows.filter((band) => band.place === place)
  let pool = key.place !== 'spain' ? at(key.place) : []
  if (pool.length === 0) pool = at('spain')
  if (pool.length === 0 && key.place === 'spain') {
    const total = (place: Band['place']) => at(place).reduce((sum, band) => sum + band.min + band.max, 0)
    const least = (['sevilla', 'bilbao'] as const).filter((place) => at(place).length > 0).sort((a, b) => total(a) - total(b))[0]
    pool = least ? at(least) : []
  }
  if (pool.length === 0) return null
  const wanted = LEVEL_YEARS[key.level]
  const middle = (range: readonly [number, number]) => (range[0] + range[1]) / 2
  const nearest = (a: Band, b: Band) => Math.abs(middle(a.years) - middle(wanted)) - Math.abs(middle(b.years) - middle(wanted))
  const ownLevel = pool.filter((band) => band.levels)
  if (ownLevel.length > 0) {
    const fitting = ownLevel.filter((band) => band.levels?.includes(key.level))
    return fitting.sort((a, b) => overlap(b.years, wanted) - overlap(a.years, wanted) || nearest(a, b))[0] ?? 'level'
  }
  // Heading a function is not doing it: a "Head of Brand" is not given a
  // brand manager's figure. Only a row the source gives for heads fits one.
  if (key.level === 'head') return 'level'
  if (key.levelFrom === 'default') return [...pool].sort(nearest)[0]
  const best = pool
    .map((band) => ({ band, overlap: overlap(band.years, wanted) }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || nearest(a.band, b.band))[0]
  return best ? best.band : 'level'
}

export interface EstimableOffer {
  title: string
  location: string | null
  workplace: string | null
  description: string | null
  salary_raw: string | null
  salary_min: number | null
  salary_max: number | null
  company_segment: string | null
}

export function estimateOffer(offer: EstimableOffer): Stored {
  const v = ESTIMATE_VERSION
  if (offer.salary_raw || offer.salary_min || offer.salary_max) return { v, estimate: null, none: 'published' }
  if (salaryInText(offer.description)) return { v, estimate: null, none: 'in_text' }
  const key = keyOf({
    title: offer.title,
    location: offer.location,
    workplace: offer.workplace,
    description: offer.description,
    companySegment: offer.company_segment,
  })
  if (key === 'role' || key === 'place') return { v, estimate: null, none: key }
  const band = bandFor(key)
  if (band === null) return { v, estimate: null, none: 'source' }
  if (band === 'level') return { v, estimate: null, none: 'level' }
  const source = SOURCES[band.source]
  return {
    v,
    estimate: {
      min: band.min,
      max: band.max,
      currency: 'EUR',
      source: source.name,
      year: source.year,
      url: band.url,
      role: band.name,
      experience: band.experience,
      place: band.place,
      key,
    },
  }
}

function parse(raw: string | null): Stored | null {
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as Stored
    return stored.v === ESTIMATE_VERSION ? stored : null
  } catch {
    return null
  }
}

const CHUNK = 400

// The estimate of each offer, computed and kept on it the first time (or
// when the table changed since). What is already kept is only read.
export function estimatesFor(opportunityIds: string[]): Map<string, SalaryEstimate | null> {
  const db = getDb()
  const result = new Map<string, SalaryEstimate | null>()
  const ids = [...new Set(opportunityIds)]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const marks = chunk.map(() => '?').join(', ')
    const kept = db.prepare(`SELECT opportunity_id AS id, estimate FROM opportunity_salary_estimates WHERE opportunity_id IN (${marks})`).all(...chunk) as unknown as {
      id: string
      estimate: string
    }[]
    const known = new Map(kept.map((row) => [row.id, parse(row.estimate)]))
    const missing: string[] = []
    for (const id of chunk) {
      const stored = known.get(id)
      if (stored) result.set(id, stored.estimate)
      else missing.push(id)
    }
    if (missing.length === 0) continue
    const rows = db
      .prepare(
        `SELECT o.id, o.title, o.location, o.workplace, o.description, o.salary_raw, o.salary_min, o.salary_max, c.segment AS company_segment
         FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.id IN (${missing.map(() => '?').join(', ')})`,
      )
      .all(...missing) as unknown as (EstimableOffer & { id: string })[]
    const keep = db.prepare(
      `INSERT INTO opportunity_salary_estimates (opportunity_id, estimate, created_at) VALUES (?, ?, ?)
       ON CONFLICT (opportunity_id) DO UPDATE SET estimate = excluded.estimate, created_at = excluded.created_at`,
    )
    inTransaction(() => {
      for (const row of rows) {
        const stored = estimateOffer(row)
        keep.run(row.id, JSON.stringify(stored), new Date().toISOString())
        result.set(row.id, stored.estimate)
      }
    })
  }
  return result
}

// How much a salary can fall below someone's floor before it is worth a
// warning: the same margin a published salary gets before it is a no.
const FLOOR_MARGIN = 0.1

export function belowFloor(estimate: SalaryEstimate | null, floor: { amount: number; currency: string } | null): boolean {
  return Boolean(estimate && floor && floor.currency === estimate.currency && estimate.max < floor.amount * (1 - FLOOR_MARGIN))
}

// For ordering: a published salary first, then an estimate that reaches the
// floor (or any, with no floor), then nothing known, then an estimate below
// the floor. Never a reason to leave an offer out.
export function payRank(item: { salary: string | null; estimate: ShownEstimate | null }): number {
  if (item.salary) return 3
  if (!item.estimate) return 1
  return item.estimate.belowFloor !== null ? 0 : 2
}

// What a screen or a message shows: the figures, where they come from, and
// whether they fall short of the person's floor. Nothing about how the offer
// was placed in the table.
export interface ShownEstimate {
  min: number
  max: number
  source: string
  year: number
  url: string
  role: string
  experience: string
  place: SalaryEstimate['place']
  // Their floor, when the estimate's top falls short of it.
  belowFloor: number | null
}

export function shownEstimate(estimate: SalaryEstimate | null | undefined, floor: { amount: number; currency: string } | null): ShownEstimate | null {
  if (!estimate) return null
  const { min, max, source, year, url, role, experience, place } = estimate
  // An offer that does not say its level gets the middle of the table, which
  // may not be theirs: a "below your floor" on that guess would put them off
  // an offer for a figure nobody stated.
  const guessed = estimate.key?.levelFrom === 'default'
  return { min, max, source, year, url, role, experience, place, belowFloor: floor && !guessed && belowFloor(estimate, floor) ? floor.amount : null }
}
