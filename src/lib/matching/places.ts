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

// A country excluded is also every place in it that offers write without the
// country: "Massachusetts - Boston", "Wichita, KS" under "USA", "Princeton".
// States and cities only, and none that shares its name with a place in Europe
// (no Georgia, Cambridge, Birmingham or Portland).
const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'hawaii',
  'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
  'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
]
const US_CITIES = [
  'nyc', 'new york city', 'brooklyn', 'manhattan', 'jersey city', 'san francisco', 'bay area', 'palo alto', 'mountain view',
  'menlo park', 'sunnyvale', 'santa clara', 'san jose', 'san mateo', 'foster city', 'redwood city', 'oakland', 'los angeles',
  'san diego', 'sacramento', 'seattle', 'redmond', 'austin', 'dallas', 'houston', 'boston', 'chicago', 'denver', 'boulder',
  'atlanta', 'miami', 'philadelphia', 'pittsburgh', 'phoenix', 'salt lake city', 'raleigh', 'charlotte', 'nashville',
  'detroit', 'minneapolis', 'st louis', 'kansas city', 'indianapolis', 'baltimore', 'las vegas', 'orlando', 'tampa',
  'washington dc', 'washington d c',
]

export function placeTerms(term: string): string[] {
  const group = SAME_PLACE.find((names) => names.includes(term))
  if (group === SAME_PLACE[0]) return [...group, ...US_STATES, ...US_CITIES]
  return group ?? [term]
}

// The towns of a city's area, for an office a candidate accepts in that city:
// Paterna is Valencia's, as far as a commute goes.
const CITY_AREAS: Record<string, string[]> = {
  valencia: [
    'valencia', 'paterna', 'burjassot', 'mislata', 'manises', 'alboraya', 'alboraia', 'godella', 'quart de poblet',
    'xirivella', 'chirivella', 'picanya', 'torrent', 'alaquas', 'aldaia', 'alfafar', 'catarroja', 'moncada', 'massamagrell',
    'rocafort', 'betera', 'puzol', 'pucol', 'sedavi', 'benetusser', 'paiporta',
  ],
  madrid: [
    'madrid', 'alcobendas', 'las rozas', 'pozuelo', 'pozuelo de alarcon', 'boadilla del monte', 'majadahonda',
    'san sebastian de los reyes', 'tres cantos', 'getafe', 'leganes', 'alcorcon', 'mostoles', 'fuenlabrada', 'coslada',
    'san fernando de henares', 'rivas vaciamadrid', 'alcala de henares', 'torrejon de ardoz',
  ],
  barcelona: [
    'barcelona', 'l hospitalet', 'hospitalet de llobregat', 'sant cugat', 'sant cugat del valles', 'badalona', 'cornella',
    'el prat', 'prat de llobregat', 'esplugues', 'sant joan despi', 'sant boi', 'viladecans', 'castelldefels', 'terrassa',
    'sabadell', 'mataro', 'granollers', 'rubi', 'cerdanyola',
  ],
}

export function cityAreaTerms(term: string): string[] {
  return CITY_AREAS[term] ?? [term]
}

// The cities that place an offer in someone's own country, for ordering: a
// posting in Barcelona is in Spain for someone in Valencia, even when the
// listing never says "Spain".
const COUNTRY_CITIES: Record<string, string[]> = {
  ES: [
    ...CITY_AREAS.valencia, ...CITY_AREAS.madrid, ...CITY_AREAS.barcelona,
    'sevilla', 'seville', 'malaga', 'bilbao', 'zaragoza', 'alicante', 'murcia', 'palma', 'palma de mallorca', 'las palmas',
    'santa cruz de tenerife', 'valladolid', 'vigo', 'a coruna', 'la coruna', 'gijon', 'oviedo', 'granada', 'cordoba',
    'san sebastian', 'donostia', 'vitoria', 'pamplona', 'santander', 'castellon', 'elche', 'cadiz', 'salamanca', 'leon',
    'tarragona', 'girona', 'lleida', 'logrono', 'burgos', 'almeria', 'huelva', 'jaen', 'badajoz', 'caceres', 'toledo',
  ],
}

export function countryCityTerms(code: string): string[] {
  return COUNTRY_CITIES[code] ?? []
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

// Countries as offers name them (normalised), for telling a list of countries
// where a remote role is hired from its office cities.
const COUNTRY_NAMES: Record<string, string> = {
  spain: 'ES', espana: 'ES', portugal: 'PT', france: 'FR', germany: 'DE', deutschland: 'DE', italy: 'IT', italia: 'IT',
  netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL', belgium: 'BE', ireland: 'IE', 'united kingdom': 'GB', uk: 'GB',
  england: 'GB', scotland: 'GB', switzerland: 'CH', austria: 'AT', poland: 'PL', sweden: 'SE', denmark: 'DK', norway: 'NO',
  finland: 'FI', 'czech republic': 'CZ', czechia: 'CZ', romania: 'RO', bulgaria: 'BG', greece: 'GR', hungary: 'HU',
  croatia: 'HR', estonia: 'EE', latvia: 'LV', lithuania: 'LT', luxembourg: 'LU', slovakia: 'SK', slovenia: 'SI', cyprus: 'CY',
  malta: 'MT', iceland: 'IS', serbia: 'RS', ukraine: 'UA', turkey: 'TR', 'united states': 'US', usa: 'US', us: 'US',
  'united states of america': 'US', canada: 'CA', mexico: 'MX', brazil: 'BR', brasil: 'BR', argentina: 'AR', colombia: 'CO',
  chile: 'CL', peru: 'PE', uruguay: 'UY', india: 'IN', japan: 'JP', china: 'CN', singapore: 'SG', australia: 'AU',
  'new zealand': 'NZ', israel: 'IL', 'united arab emirates': 'AE', uae: 'AE', 'south africa': 'ZA', nigeria: 'NG', kenya: 'KE',
  egypt: 'EG', philippines: 'PH', indonesia: 'ID', vietnam: 'VN', thailand: 'TH', 'south korea': 'KR', korea: 'KR',
}

// The country a location segment names, when it is a country and nothing else
// ("Germany", "The Netherlands"; not "Berlin", not "EMEA").
export function countryOf(place: string): string | null {
  return COUNTRY_NAMES[place.trim()] ?? null
}

// The places a sentence about where the work is done names, for the checks
// made on an offer's facts (facts.ts): the countries (with the US's states and
// cities), and whether it opens to Europe, to anywhere, names a region or city
// outside Europe, or a European city (whose country is not known here).
export interface PlacesNamed {
  countries: Set<string>
  europe: boolean
  anywhere: boolean
  outside: boolean
  europeanCity: boolean
}

const EUROPE_WORDS = ['europe', 'european', 'emea', 'eu', 'eea']
const ANYWHERE_WORDS = ['anywhere', 'worldwide', 'world wide', 'global', 'globally', 'international', 'any country', 'any location']
// "us" is also the pronoun ("join us"): the country only as written in capitals.
const US_IN_CAPITALS = /\bU\.?S\.?(A\.?)?(?![A-Za-z])/
const PRONOUN_FORMS = new Set(['us', 'u s'])

export function placesNamedIn(text: string): PlacesNamed {
  const t = normaliseTitle(text)
  const countries = new Set<string>()
  for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
    if (!PRONOUN_FORMS.has(name) && names(t, name)) countries.add(code)
  }
  if (placeTerms('united states').some((term) => !PRONOUN_FORMS.has(term) && names(t, term)) || US_IN_CAPITALS.test(text)) countries.add('US')
  const outside = [...OUTSIDE_EUROPE_AREAS, ...OUTSIDE_EUROPE_CITIES].some((term) => !PRONOUN_FORMS.has(term) && names(t, term))
  const europeanCity = EUROPE_OR_ANYWHERE.some(
    (term) => !COUNTRY_NAMES[term] && !EUROPE_WORDS.includes(term) && !ANYWHERE_WORDS.includes(term) && names(t, term),
  )
  return {
    countries,
    europe: EUROPE_WORDS.some((term) => names(t, term)),
    anywhere: ANYWHERE_WORDS.some((term) => names(t, term)),
    outside,
    europeanCity,
  }
}

// Regions and words that open a list to someone anywhere in Europe.
const OPEN_REGIONS = ['europe', 'european', 'emea', 'eu', 'eea', 'anywhere', 'worldwide', 'global', 'international', 'remote']

export function placeIsOpenRegion(place: string): boolean {
  return OPEN_REGIONS.some((term) => names(place, term))
}

// A place outside Europe, named on its own: a country, a region or a city
// ("Toronto", "North America"). Unlike remoteOutsideEurope, no "Remote" is
// needed in it: it is used where the offer is already known to be remote.
export function placeOutsideEurope(place: string): boolean {
  if (EUROPE_OR_ANYWHERE.some((term) => names(place, term))) return false
  return OUTSIDE_EUROPE_AREAS.some((term) => names(place, term)) || OUTSIDE_EUROPE_CITIES.some((term) => names(place, term))
}

// A place that also opens the role to a wider region ("United States or
// Europe", "US & EMEA") is never only the excluded place.
const WIDER_REGIONS = ['europe', 'european', 'emea', 'eu', 'eea', 'anywhere', 'worldwide', 'global', 'international']

export function placeMatches(place: string, term: string): boolean {
  const forms = placeTerms(term)
  if (!forms.some((form) => names(place, form))) return false
  return !WIDER_REGIONS.some((open) => !forms.includes(open) && names(place, open))
}

// "USA - Houston (+6)": Workday lists the first of several places and only
// counts the rest. Where those are is not known.
export function hasUnlistedPlaces(location: string | null): boolean {
  return /\(\+\d+\)/.test(location ?? '')
}
