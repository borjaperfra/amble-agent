import { normaliseTitle } from '../sourcing/text'

// Places as offers write them, for the free prefilter. Location fields mix a
// place with how the work is done ("Remote - US", "Hybrid, Madrid"); only the
// place says where someone must live.

// EU and EEA, the UK and Switzerland (ISO 3166-1 alpha-2).
export const EUROPE = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]

// Words about the way of working, not the place.
const WORK_WORDS = /\b(remote|remoto|remota|fully|full|hybrid|hibrido|hibrida|onsite|on site|office|oficina|based|first|friendly|wfh|work from home)\b/g

// A location segment's place, without the way of working. Null when nothing
// is left ("Remote" alone says nothing about where).
export function placeOf(segment: string): string | null {
  const place = normaliseTitle(segment).replace(WORK_WORDS, ' ').replace(/\s+/g, ' ').trim()
  return place || null
}

// Short forms offers use for the same country.
const SAME_PLACE: string[][] = [
  ['united states', 'usa', 'us', 'u s', 'u s a', 'estados unidos', 'eeuu', 'ee uu'],
  ['united kingdom', 'uk', 'u k', 'great britain', 'england'],
]

export function placeTerms(term: string): string[] {
  const group = SAME_PLACE.find((names) => names.includes(term))
  return group ?? [term]
}

// Regions and countries outside Europe. A remote offer located in one of
// these is remote from there.
const OUTSIDE_EUROPE_AREAS = [
  ...SAME_PLACE[0],
  'north america', 'namer', 'amer', 'americas', 'latam', 'latin america', 'south america', 'apac', 'asia', 'asia pacific',
  'asean', 'anz', 'mena', 'middle east', 'africa', 'canada', 'mexico', 'brazil', 'brasil', 'argentina', 'colombia', 'chile',
  'peru', 'india', 'japan', 'china', 'korea', 'south korea', 'singapore', 'hong kong', 'taiwan', 'philippines', 'indonesia',
  'malaysia', 'vietnam', 'thailand', 'australia', 'new zealand', 'israel', 'uae', 'united arab emirates', 'saudi arabia',
  'turkey', 'egypt', 'nigeria', 'kenya', 'south africa', 'pakistan',
]

// Cities outside Europe. For a remote offer a list of cities is usually where
// the offices are, not where one must live, so a city alone ties remote work
// to it only when the offer says so ("Remote - Toronto").
const OUTSIDE_EUROPE_CITIES = [
  'new york', 'nyc', 'san francisco', 'bay area', 'seattle', 'austin', 'boston', 'chicago', 'los angeles', 'denver',
  'atlanta', 'miami', 'toronto', 'vancouver', 'montreal', 'sao paulo', 'mexico city', 'bengaluru', 'bangalore',
  'hyderabad', 'mumbai', 'delhi', 'pune', 'chennai', 'tokyo', 'seoul', 'sydney', 'melbourne', 'tel aviv', 'dubai',
  'riyadh', 'istanbul',
]

// Words that make a place European, or open to anyone.
const EUROPE_OR_ANYWHERE = [
  'europe', 'european', 'emea', 'eu', 'eea', 'spain', 'espana', 'madrid', 'barcelona', 'valencia', 'malaga', 'sevilla',
  'bilbao', 'portugal', 'lisbon', 'porto', 'france', 'paris', 'germany', 'berlin', 'munich', 'hamburg', 'netherlands',
  'amsterdam', 'ireland', 'dublin', 'italy', 'milan', 'rome', 'poland', 'warsaw', 'krakow', 'united kingdom', 'uk',
  'london', 'sweden', 'stockholm', 'denmark', 'copenhagen', 'finland', 'helsinki', 'norway', 'oslo', 'switzerland',
  'zurich', 'austria', 'vienna', 'belgium', 'brussels', 'czech', 'prague', 'romania', 'bucharest', 'greece', 'athens',
  'estonia', 'tallinn', 'anywhere', 'worldwide', 'global', 'international',
]

function names(place: string, term: string): boolean {
  return ` ${place} `.includes(` ${term} `)
}

const REMOTE_WORD = /\b(remote|remoto|remota)\b/

// A location segment that ties remote work to somewhere outside Europe:
// "Remote - India", "US-Remote", "Canada", "NAMER". It must name nowhere in
// Europe ("Americas or EMEA" is open to Europe).
export function remoteOutsideEurope(segment: string): boolean {
  const place = placeOf(segment)
  if (!place || EUROPE_OR_ANYWHERE.some((term) => names(place, term))) return false
  if (OUTSIDE_EUROPE_AREAS.some((term) => names(place, term))) return true
  return REMOTE_WORD.test(normaliseTitle(segment)) && OUTSIDE_EUROPE_CITIES.some((term) => names(place, term))
}

export function placeMatches(place: string, term: string): boolean {
  return placeTerms(term).some((form) => names(place, form))
}
