import { clampText, decodeEntities, htmlToText, inferWorkplace, normaliseName } from './text'
import { safeFetchText, urlProblem } from '../net/safe-fetch'
import { SourceError, type AtsKind, type RawOpportunity, type Workplace } from './types'

// Public job-board APIs that companies use to power their own careers pages.
// Each returns the company's full current list, so an offer missing from a
// successful read has closed.

// Greenhouse draws a big board with its texts on demand when it is not cached:
// Anthropic's took 23 s on 2026-09-30, and at 20 s it was lost for the pass.
const TIMEOUT_MS = 45_000
// A careers page is read only to find the board it links to.
const CAREERS_PAGE_BYTES = 5 * 1024 * 1024
const USER_AGENT = 'Amble/0.1 (+job sourcing for a single candidate)'

// One request to a board, bounded in time from the first byte sent to the
// last one read. A board's address is built from its token, and some tokens
// are hosts (a Teamtailor or SuccessFactors site on the company's own
// domain): one that names a private address or name is never asked.
async function fetchBoard<T>(
  url: string,
  source: AtsKind,
  init: RequestInit,
  read: (response: Response) => Promise<T | null>,
): Promise<T | null> {
  const problem = urlProblem(url)
  if (problem) throw new SourceError(`${source} board address refused: ${problem}`, source)
  try {
    const response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status === 429) throw new SourceError(`${source} rate limit reached`, source, 429)
    return await read(response)
  } catch (error) {
    if (error instanceof SourceError) throw error
    throw new SourceError(`${source} could not be read: ${error instanceof Error ? error.message : 'unknown error'}`, source)
  }
}

async function getJson(url: string, source: AtsKind): Promise<unknown | null> {
  return fetchBoard(url, source, { headers: { Accept: 'application/json' } }, async (response) => {
    if (response.status === 404) return null
    if (!response.ok) throw new SourceError(`${source} answered ${response.status}`, source, response.status)
    return (await response.json()) as unknown
  })
}

function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// ── Greenhouse ───────────────────────────────────────────────────────────

interface GreenhouseJob {
  id: number
  title: string
  absolute_url: string
  location?: { name?: string }
  content?: string
  first_published?: string
  updated_at?: string
  company_name?: string
}

async function readGreenhouse(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`, 'greenhouse')) as
    | { jobs?: GreenhouseJob[] }
    | null
  if (!data?.jobs) return null
  return data.jobs.map((job) => {
    const location = job.location?.name ?? null
    const description = htmlToText(job.content)
    return {
      source: 'greenhouse',
      externalId: String(job.id),
      companyName,
      title: job.title.trim(),
      location,
      workplace: inferWorkplace(location, job.title),
      url: job.absolute_url,
      description,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: toIso(job.first_published ?? job.updated_at),
    }
  })
}

// ── Lever ────────────────────────────────────────────────────────────────

interface LeverJob {
  id: string
  text: string
  hostedUrl: string
  categories?: { location?: string; allLocations?: string[]; team?: string; department?: string }
  workplaceType?: string
  descriptionPlain?: string
  additionalPlain?: string
  lists?: { text: string; content: string }[]
  createdAt?: number
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string }
}

function leverWorkplace(value: string | undefined, location: string | null): Workplace | null {
  if (value === 'remote') return 'remote'
  if (value === 'hybrid') return 'hybrid'
  if (value === 'onsite' || value === 'on-site') return 'onsite'
  return inferWorkplace(location)
}

// A board on Lever's EU instance (jobs.eu.lever.co/<site>) is pinned as
// "eu:<site>"; a bare site is on the global one.
export const LEVER_EU_PREFIX = 'eu:'

async function readLever(board: string, companyName: string): Promise<RawOpportunity[] | null> {
  const eu = board.startsWith(LEVER_EU_PREFIX)
  const token = eu ? board.slice(LEVER_EU_PREFIX.length) : board
  const host = eu ? 'api.eu.lever.co' : 'api.lever.co'
  const data = (await getJson(`https://${host}/v0/postings/${encodeURIComponent(token)}?mode=json`, 'lever')) as LeverJob[] | null
  if (!Array.isArray(data)) return null
  return data.map((job) => {
    const location = job.categories?.allLocations?.join(' · ') || job.categories?.location || null
    const lists = (job.lists ?? []).map((list) => `${list.text}\n${htmlToText(list.content) ?? ''}`).join('\n\n')
    const salary = job.salaryRange
    const annual = !salary?.interval || /year|annual/i.test(salary.interval)
    return {
      source: 'lever',
      externalId: job.id,
      companyName,
      title: job.text.trim(),
      location,
      workplace: leverWorkplace(job.workplaceType, location),
      url: job.hostedUrl,
      description: clampText([job.descriptionPlain, lists, job.additionalPlain].filter(Boolean).join('\n\n')),
      salaryMin: annual && salary?.min ? Math.round(salary.min) : null,
      salaryMax: annual && salary?.max ? Math.round(salary.max) : null,
      salaryCurrency: salary?.currency ?? null,
      salaryRaw: salary ? `${salary.min ?? '?'}–${salary.max ?? '?'} ${salary.currency ?? ''} ${salary.interval ?? ''}`.trim() : null,
      postedAt: toIso(job.createdAt),
    }
  })
}

// ── Ashby ────────────────────────────────────────────────────────────────

interface AshbyJob {
  id: string
  title: string
  location?: string
  secondaryLocations?: { location?: string }[]
  isRemote?: boolean
  workplaceType?: string
  jobUrl: string
  descriptionPlain?: string
  descriptionHtml?: string
  publishedAt?: string
  isListed?: boolean
  compensation?: { scrapeableCompensationSalarySummary?: string | null; compensationTierSummary?: string | null }
}

function ashbyWorkplace(job: AshbyJob, location: string | null): Workplace | null {
  const type = job.workplaceType?.toLowerCase()
  if (type === 'remote' || job.isRemote) return 'remote'
  if (type === 'hybrid') return 'hybrid'
  if (type === 'onsite') return 'onsite'
  return inferWorkplace(location)
}

async function readAshby(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const data = (await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`,
    'ashby',
  )) as { jobs?: AshbyJob[] } | null
  if (!data?.jobs) return null
  return data.jobs
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const location = [job.location, ...(job.secondaryLocations ?? []).map((entry) => entry.location)].filter(Boolean).join(' · ') || null
      return {
        source: 'ashby',
        externalId: job.id,
        companyName,
        title: job.title.trim(),
        location,
        workplace: ashbyWorkplace(job, location),
        url: job.jobUrl,
        description: clampText(job.descriptionPlain) ?? htmlToText(job.descriptionHtml),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryRaw: job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? null,
        postedAt: toIso(job.publishedAt),
      }
    })
}

// ── Workable ─────────────────────────────────────────────────────────────

interface WorkableJob {
  shortcode: string
  title: string
  url: string
  telecommuting?: boolean
  city?: string
  country?: string
  locations?: { city?: string; country?: string }[]
  description?: string
  published_on?: string
}

async function readWorkable(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const data = (await getJson(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`,
    'workable',
  )) as { jobs?: WorkableJob[] } | null
  if (!data?.jobs) return null
  return data.jobs.map((job) => {
    const places = (job.locations?.length ? job.locations : [{ city: job.city, country: job.country }])
      .map((place) => [place.city, place.country].filter(Boolean).join(', '))
      .filter(Boolean)
    const location = places.join(' · ') || null
    return {
      source: 'workable',
      externalId: job.shortcode,
      companyName,
      title: job.title.trim(),
      location,
      workplace: job.telecommuting ? 'remote' : inferWorkplace(location, job.title),
      url: job.url,
      description: htmlToText(job.description),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: toIso(job.published_on),
    }
  })
}

// ── Teamtailor ───────────────────────────────────────────────────────────
// Every Teamtailor careers site publishes an RSS feed of its open offers. The
// token is the site's host: a *.teamtailor.com subdomain or the company's own
// domain (careers.company.com).

// Unknown boards redirect (Personio) or 404 (Teamtailor): both mean no board.
async function getText(url: string, source: AtsKind): Promise<string | null> {
  return fetchBoard(url, source, { redirect: 'manual' }, async (response) => {
    if (response.status === 404 || (response.status >= 300 && response.status < 400)) return null
    if (!response.ok) throw new SourceError(`${source} answered ${response.status}`, source, response.status)
    return response.text()
  })
}

function xmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return null
  const value = match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim()
  return value ? decodeEntities(value) : null
}

function xmlBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((match) => match[1])
}

function teamtailorWorkplace(value: string | null, location: string | null): Workplace | null {
  if (value === 'fully') return 'remote'
  if (value === 'hybrid') return 'hybrid'
  if (value === 'none') return 'onsite'
  return inferWorkplace(location)
}

async function readTeamtailor(host: string, companyName: string): Promise<RawOpportunity[] | null> {
  const xml = await getText(`https://${host}/jobs.rss`, 'teamtailor')
  if (!xml || !/<rss/i.test(xml)) return null
  return xmlBlocks(xml, 'item').map((item) => {
    const places = xmlBlocks(item, 'tt:location').map((place) =>
      [xmlTag(place, 'tt:city') ?? xmlTag(place, 'tt:name'), xmlTag(place, 'tt:country')].filter(Boolean).join(', '),
    )
    const location = places.filter(Boolean).join(' · ') || null
    const link = xmlTag(item, 'link')
    return {
      source: 'teamtailor',
      externalId: xmlTag(item, 'guid') ?? link ?? '',
      companyName,
      title: (xmlTag(item, 'title') ?? '').trim(),
      location,
      workplace: teamtailorWorkplace(xmlTag(item, 'remoteStatus'), location),
      url: link,
      description: htmlToText(xmlTag(item, 'description')),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: toIso(xmlTag(item, 'pubDate')),
    }
  })
}

// ── Factorial ────────────────────────────────────────────────────────────
// Factorial's careers site (<company>.factorialhr.com, .factorialhr.co or
// .factorial.es) is drawn on the server: each offer is a list item carrying
// its link, whether it is remote, and under the heading of its office. Many
// Spanish companies hire through it. The offer's text is on its own page,
// read when judged.

const FACTORIAL_HOST = /^[a-z0-9-]+\.factorial(?:hr)?\.(?:com|co|es)$/i

async function readFactorial(host: string, companyName: string): Promise<RawOpportunity[] | null> {
  if (!FACTORIAL_HOST.test(host)) return null
  const html = await getText(`https://${host}/`, 'factorial')
  if (!html || !/job-offer-item|job_posting/i.test(html)) return html && /factorial/i.test(html) ? [] : null
  const offers: RawOpportunity[] = []
  // Offices are headings; the offers under each belong to it.
  const sections = html.split(/<h3[^>]*>/i)
  for (const section of sections.slice(1)) {
    const office = decodeEntities(section.slice(0, section.indexOf('</h3>')).replace(/<[^>]+>/g, '').trim())
    for (const item of section.match(/<li class='job-offer-item[\s\S]*?<\/li>/gi) ?? []) {
      const url = item.match(/data-job-postings-url='([^']+)'/i)?.[1]
      const title = item.match(/font-bold[^>]*>([^<]+)</i)?.[1]
      if (!url || !title) continue
      const remote = item.match(/data-is-remote='(true|false)'/i)?.[1] === 'true'
      const texts = [...item.matchAll(/text-gray-350[^>]*>([^<]+)</gi)].map((match) => decodeEntities(match[1].trim()))
      const mode = texts.find((text) => /hybrid|híbrido|remote|remoto|on-?site|presencial/i.test(text)) ?? null
      offers.push({
        source: 'factorial',
        externalId: url.split('/').pop() ?? url,
        companyName,
        title: decodeEntities(title.trim()),
        location: office && !/^remote|^remoto/i.test(office) ? office : null,
        workplace: remote ? 'remote' : inferWorkplace(mode),
        url,
        description: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryRaw: null,
        postedAt: null,
      })
    }
  }
  return offers
}

// ── Recruitee ────────────────────────────────────────────────────────────

interface RecruiteeOffer {
  id: number
  title: string
  status?: string
  careers_url: string
  location?: string
  locations?: { city?: string; country?: string }[]
  remote?: boolean
  hybrid?: boolean
  on_site?: boolean
  description?: string
  requirements?: string
  published_at?: string
  company_name?: string
  salary?: { min?: string | number | null; max?: string | number | null; currency?: string | null; period?: string | null }
}

async function readRecruitee(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const data = (await getJson(`https://${encodeURIComponent(token)}.recruitee.com/api/offers/`, 'recruitee')) as { offers?: RecruiteeOffer[] } | null
  if (!data?.offers) return null
  return data.offers
    // Accounts that never hired for real still serve Recruitee's seeded demo
    // posting, which the platform itself titles "(Sample)".
    .filter((offer) => (!offer.status || offer.status === 'published') && !/\(sample\)/i.test(offer.title))
    .map((offer) => {
      const places = (offer.locations ?? []).map((place) => [place.city, place.country].filter(Boolean).join(', ')).filter(Boolean)
      const location = places.join(' · ') || offer.location || null
      const salary = offer.salary
      const annual = !salary?.period || /year/i.test(salary.period)
      const min = salary?.min ? Number(salary.min) : null
      const max = salary?.max ? Number(salary.max) : null
      return {
        source: 'recruitee',
        externalId: String(offer.id),
        companyName,
        title: offer.title.trim(),
        location,
        workplace: offer.remote ? 'remote' : offer.hybrid ? 'hybrid' : offer.on_site ? 'onsite' : inferWorkplace(location, offer.title),
        url: offer.careers_url,
        description: htmlToText([offer.description, offer.requirements].filter(Boolean).join('\n')),
        salaryMin: annual && min ? Math.round(min) : null,
        salaryMax: annual && max ? Math.round(max) : null,
        salaryCurrency: min || max ? (salary?.currency ?? null) : null,
        salaryRaw: min || max ? `${min ?? '?'}–${max ?? '?'} ${salary?.currency ?? ''} ${salary?.period ?? ''}`.trim() : null,
        postedAt: toIso(offer.published_at),
      }
    })
}

// ── Personio ─────────────────────────────────────────────────────────────
// Personio publishes an XML feed per company. It carries no posting URL; the
// public page for a position is /job/<id> on the same host.

async function readPersonio(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const host = `${encodeURIComponent(token)}.jobs.personio.de`
  const xml = await getText(`https://${host}/xml`, 'personio')
  if (!xml || !/<workzag-jobs/i.test(xml)) return null
  return xmlBlocks(xml, 'position').map((block) => {
    // Descriptions carry their own <name> tags, so the position's own fields
    // are read with them removed.
    const position = block.replace(/<jobDescriptions>[\s\S]*?<\/jobDescriptions>/gi, '')
    const id = xmlTag(position, 'id') ?? ''
    const offices = [xmlTag(position, 'office'), ...xmlBlocks(xmlTag(position, 'additionalOffices') ?? '', 'office').map(decodeEntities)]
    const location = [...new Set(offices.filter(Boolean))].join(' · ') || null
    const title = (xmlTag(position, 'name') ?? '').trim()
    const description = xmlBlocks(block, 'jobDescription')
      .map((block) => `${xmlTag(block, 'name') ?? ''}\n${xmlTag(block, 'value') ?? ''}`)
      .join('\n')
    return {
      source: 'personio',
      externalId: id,
      companyName,
      title,
      location,
      workplace: inferWorkplace(location, title),
      url: `https://${host}/job/${id}`,
      description: htmlToText(description),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: toIso(xmlTag(position, 'createdAt')),
    }
  })
}

// ── BambooHR ─────────────────────────────────────────────────────────────
// The list carries no description, so each opening's detail is read too.
// Boards are small; a bound keeps one unusually large board from stalling a run.

const BAMBOOHR_MAX_DETAILS = 60
const BAMBOOHR_DETAILS_AT_ONCE = 4

interface BambooListing {
  id: string
  jobOpeningName: string
  location?: { city?: string | null; state?: string | null }
  isRemote?: boolean | null
  locationType?: string | null
}

interface BambooDetail {
  jobOpening?: {
    jobOpeningShareUrl?: string
    description?: string
    datePosted?: string
    location?: { city?: string | null; state?: string | null; addressCountry?: string | null }
    compensation?: string | null
  }
}

function bambooWorkplace(listing: BambooListing, location: string | null): Workplace | null {
  if (listing.isRemote || listing.locationType === '1') return 'remote'
  if (listing.locationType === '2') return 'hybrid'
  if (listing.locationType === '0') return 'onsite'
  return inferWorkplace(location, listing.jobOpeningName)
}

async function readBambooHr(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const base = `https://${encodeURIComponent(token)}.bamboohr.com/careers`
  const text = await getText(`${base}/list`, 'bamboohr')
  if (!text) return null
  let listings: BambooListing[]
  try {
    listings = (JSON.parse(text) as { result?: BambooListing[] }).result ?? []
  } catch {
    return null
  }
  // A few details at a time: a board with dozens of openings no longer reads
  // them one after another.
  const details: (BambooDetail | null)[] = []
  const wanted = listings.slice(0, BAMBOOHR_MAX_DETAILS)
  for (let at = 0; at < wanted.length; at += BAMBOOHR_DETAILS_AT_ONCE) {
    const batch = wanted.slice(at, at + BAMBOOHR_DETAILS_AT_ONCE).map(async (listing) => {
      const detail = (await getJson(`${base}/${encodeURIComponent(listing.id)}/detail`, 'bamboohr').catch(() => null)) as { result?: BambooDetail } | null
      return detail?.result ?? null
    })
    details.push(...(await Promise.all(batch)))
  }
  const opportunities: RawOpportunity[] = []
  for (const [index, listing] of listings.entries()) {
    const opening = details[index]?.jobOpening
    const place = opening?.location ?? listing.location
    const location = [place?.city, place?.state, opening?.location?.addressCountry].filter(Boolean).join(', ') || null
    opportunities.push({
      source: 'bamboohr',
      externalId: listing.id,
      companyName,
      title: listing.jobOpeningName.trim(),
      location,
      workplace: bambooWorkplace(listing, location),
      url: opening?.jobOpeningShareUrl ?? `${base}/${listing.id}`,
      description: htmlToText(opening?.description),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: opening?.compensation ?? null,
      postedAt: toIso(opening?.datePosted),
    })
  }
  return opportunities
}

// ── Workday ──────────────────────────────────────────────────────────────
//
// The board's token is "tenant.wdN/site" (acme.wd3/External), from the URL of
// its careers site. The list gives no description: it is fetched when an offer
// is about to be judged (describeOpportunity), not for the thousands a big
// company posts.

const WORKDAY_PAGE = 20
const BOARD_MAX = 1000

function workdayParts(token: string): { host: string; tenant: string; site: string } | null {
  const match = token.match(/^([a-z0-9-]+)\.(wd\d+)\/([A-Za-z0-9_-]+)$/i)
  if (!match) return null
  const [, tenant, wd, site] = match
  return { host: `https://${tenant}.${wd}.myworkdayjobs.com`, tenant, site }
}

interface WorkdayPosting {
  title: string
  externalPath: string
  locationsText?: string
  postedOn?: string
}

// A board can list a posting with nothing but its requisition number (ING
// lists one as { bulletFields: ['REQ-…'] }): with no title or path there is no
// offer to read, so it is left out and the rest of the board still is read.
function isWorkdayPosting(posting: Partial<WorkdayPosting> | null | undefined): posting is WorkdayPosting {
  return typeof posting?.title === 'string' && posting.title.trim() !== '' && typeof posting.externalPath === 'string' && posting.externalPath !== ''
}

// "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago".
function workdayPostedAt(text: string | undefined): string | null {
  if (!text) return null
  const days = /today/i.test(text) ? 0 : /yesterday/i.test(text) ? 1 : Number(text.match(/(\d+)\+?\s+days?/i)?.[1] ?? NaN)
  if (!Number.isFinite(days)) return null
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

// "6 Locations" says nothing; the posting's path names the first one
// (/job/<place>/<slug>). A posting can come with no locationsText at all
// (Santander lists some as just title, path and date), and then its path is
// /job/<slug>, with no place in it: the location is unknown, not the slug.
function workdayLocation(posting: WorkdayPosting): string | null {
  const text = typeof posting.locationsText === 'string' ? posting.locationsText.trim() : ''
  if (text && !/^\d+\s+locations?$/i.test(text)) return text
  const segments = posting.externalPath.split('/')
  const first = segments.length > 3 ? segments[2] : undefined
  if (!first) return text || null
  const place = decodeURIComponent(first).replace(/---/g, ' - ').replace(/-/g, ' ').trim()
  return text ? `${place} (+${Number(text.match(/\d+/)?.[0] ?? 1) - 1})` : place
}

type WorkdayPage = { total?: number; jobPostings?: WorkdayPosting[] }

// A page of the board, or null when Workday says there is no such board (404,
// or 422 for a site that does not exist).
function workdayPage(endpoint: string, offset: number): Promise<WorkdayPage | null> {
  return fetchBoard(
    endpoint,
    'workday',
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE, offset, searchText: '' }),
    },
    async (response) => {
      if (response.status === 404 || response.status === 422) return null
      if (!response.ok) throw new SourceError(`workday answered ${response.status}`, 'workday', response.status)
      return (await response.json()) as WorkdayPage
    },
  )
}

// Workday serves 20 postings a page and a big board has hundreds: after the
// first page (which gives the total), the rest are asked a few at a time,
// and read in order as if one by one.
const WORKDAY_PAGES_AT_ONCE = 3

async function readWorkday(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const parts = workdayParts(token)
  if (!parts) return null
  const endpoint = `${parts.host}/wday/cxs/${parts.tenant}/${parts.site}/jobs`
  const postings: WorkdayPosting[] = []
  const opportunities = () => postings.map((posting) => workdayOpportunity(posting, parts, companyName))
  const first = await workdayPage(endpoint, 0)
  if (!first) return null
  // Workday gives the total on the first page only; later pages say 0.
  const total = first.total ?? 0
  let listed = 0
  // Whether the board goes on after this page.
  const take = (page: WorkdayPage): boolean => {
    const batch = page.jobPostings ?? []
    listed += batch.length
    postings.push(...batch.filter(isWorkdayPosting))
    return batch.length === WORKDAY_PAGE && listed < total
  }
  if (!take(first)) return opportunities()
  const offsets: number[] = []
  for (let offset = WORKDAY_PAGE; offset < Math.min(total, BOARD_MAX); offset += WORKDAY_PAGE) offsets.push(offset)
  for (let at = 0; at < offsets.length; at += WORKDAY_PAGES_AT_ONCE) {
    const pages = await Promise.all(offsets.slice(at, at + WORKDAY_PAGES_AT_ONCE).map((offset) => workdayPage(endpoint, offset)))
    for (const page of pages) {
      // A page that is not there any more ends the board where it was.
      if (!page || !take(page)) return opportunities()
    }
  }
  return opportunities()
}

function workdayOpportunity(posting: WorkdayPosting, parts: { host: string; site: string }, companyName: string): RawOpportunity {
  const location = workdayLocation(posting)
  return {
    source: 'workday',
    externalId: posting.externalPath,
    companyName,
    title: posting.title.trim(),
    location,
    workplace: inferWorkplace(location, posting.title),
    url: `${parts.host}/en-US/${parts.site}${posting.externalPath}`,
    description: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryRaw: null,
    postedAt: workdayPostedAt(posting.postedOn),
  }
}

// ── SmartRecruiters ──────────────────────────────────────────────────────
//
// The token is the company's identifier (jobs.smartrecruiters.com/<id>). As
// with Workday, descriptions are fetched when an offer is about to be judged.

const SMARTRECRUITERS_PAGE = 100

interface SmartRecruitersPosting {
  id: string
  name: string
  releasedDate?: string
  company?: { identifier?: string; name?: string }
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string }
}

async function readSmartRecruiters(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const postings: SmartRecruitersPosting[] = []
  for (let offset = 0; offset < BOARD_MAX; offset += SMARTRECRUITERS_PAGE) {
    const page = (await getJson(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=${SMARTRECRUITERS_PAGE}&offset=${offset}`,
      'smartrecruiters',
    )) as { totalFound?: number; content?: SmartRecruitersPosting[] } | null
    if (!page) return offset === 0 ? null : postings.map((p) => smartRecruitersOpportunity(p, token, companyName))
    const batch = page.content ?? []
    postings.push(...batch)
    if (batch.length < SMARTRECRUITERS_PAGE || postings.length >= (page.totalFound ?? 0)) break
  }
  // An identifier nobody uses answers with an empty list, not a 404.
  if (postings.length === 0) return []
  return postings.map((posting) => smartRecruitersOpportunity(posting, token, companyName))
}

function smartRecruitersOpportunity(posting: SmartRecruitersPosting, token: string, companyName: string): RawOpportunity {
  const place = posting.location
  const location = place?.fullLocation ?? ([place?.city, place?.region, place?.country?.toUpperCase()].filter(Boolean).join(', ') || null)
  const workplace = place?.remote ? 'remote' : place?.hybrid ? 'hybrid' : inferWorkplace(location, posting.name)
  return {
    source: 'smartrecruiters',
    externalId: posting.id,
    companyName,
    title: posting.name.trim(),
    location,
    workplace,
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(posting.id)}`,
    description: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryRaw: null,
    postedAt: toIso(posting.releasedDate),
  }
}

// ── SuccessFactors ───────────────────────────────────────────────────────
//
// SAP SuccessFactors' career site builder ("RMK") draws a company's site on
// its own host (careers.company.com) and publishes an RSS feed of every open
// offer, each with its full text. The token is that host, with a path when
// the host serves several brands and only one is the company's
// (jobs.vista.com/Vista: the same site lists Cimpress's offers). The feed
// pages by rows=, not by startrow= (which it ignores), so one request reads
// the whole board.

function successFactorsParts(token: string): { host: string; prefix: string | null } | null {
  const match = token.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/([A-Za-z0-9_-]+))?\/?$/i)
  if (!match) return null
  return { host: match[1].toLowerCase(), prefix: match[2] ?? null }
}

// Titles end with the offer's place: "Engineer (Madrid, MD, ES)",
// "Operator (Reno, NV, US, 89506)", "Accounting Manager (US)". A trailing
// "(m/w/d)" is part of the title, not a place.
// A place can hold parentheses of its own: "(PRAT DE LLOBREGAT (EL), ES, ES)".
function successFactorsTitle(raw: string): { title: string; location: string | null } {
  const text = raw.trim()
  let open = -1
  if (text.endsWith(')')) {
    for (let index = text.length - 1, depth = 0; index >= 0; index--) {
      if (text[index] === ')') depth++
      else if (text[index] === '(' && --depth === 0) {
        open = index
        break
      }
    }
  }
  if (open <= 0) return { title: text, location: null }
  const parts = text.slice(open + 1, -1).split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2 && !/^[A-Z]{2}$/.test(parts[0] ?? '')) return { title: text, location: null }
  // Postcodes (80202, D-10587, 5928 LW) and repeats say nothing more.
  const places = [...new Set(parts.filter((part) => !/\d/.test(part)))]
  return { title: text.slice(0, open).trim(), location: places.join(', ') || null }
}

async function readSuccessFactors(token: string, companyName: string): Promise<RawOpportunity[] | null> {
  const parts = successFactorsParts(token)
  if (!parts) return null
  const xml = await getText(`https://${parts.host}/services/rss/job/?locale=en_US&keywords=&rows=${BOARD_MAX}`, 'successfactors')
  if (!xml || !/<rss/i.test(xml)) return null
  const offers: RawOpportunity[] = []
  for (const item of xmlBlocks(xml, 'item')) {
    const link = xmlTag(item, 'link')
    if (!link) continue
    let url: URL
    try {
      url = new URL(link)
    } catch {
      continue
    }
    if (parts.prefix && !url.pathname.startsWith(`/${parts.prefix}/`)) continue
    const id = url.pathname.match(/\/job\/[^/]+\/(\d+)\/?$/)?.[1]
    if (!id) continue
    const { title, location } = successFactorsTitle(xmlTag(item, 'title') ?? '')
    if (!title) continue
    url.search = ''
    offers.push({
      source: 'successfactors',
      externalId: id,
      companyName,
      title,
      location,
      workplace: inferWorkplace(location, title),
      url: url.toString(),
      description: htmlToText(xmlTag(item, 'description')),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: toIso(xmlTag(item, 'pubDate')),
    })
  }
  return offers
}

// The description of an offer whose board lists none, read when it is about
// to be judged. Null when the source gives none.
export async function describeOpportunity(source: string, token: string, externalId: string): Promise<string | null> {
  if (source === 'factorial') {
    const html = await getText(`https://${token}/job_posting/${encodeURIComponent(externalId)}`, 'factorial')
    const body = html?.match(/<body[\s\S]*<\/body>/i)?.[0] ?? null
    return clampText(htmlToText(body?.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, '') ?? null))
  }
  if (source === 'workday') {
    const parts = workdayParts(token)
    if (!parts) return null
    const data = (await getJson(`${parts.host}/wday/cxs/${parts.tenant}/${parts.site}${externalId}`, 'workday')) as {
      jobPostingInfo?: { jobDescription?: string; location?: string; additionalLocations?: string[]; remoteType?: string }
    } | null
    const info = data?.jobPostingInfo
    if (!info) return null
    const where = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join(' · ')
    const body = htmlToText(info.jobDescription) ?? ''
    return clampText([where && `Locations: ${where}`, info.remoteType && `Workplace: ${info.remoteType}`, body].filter(Boolean).join('\n\n'))
  }
  if (source === 'smartrecruiters') {
    const data = (await getJson(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${encodeURIComponent(externalId)}`,
      'smartrecruiters',
    )) as { jobAd?: { sections?: Record<string, { title?: string; text?: string }> } } | null
    const sections = data?.jobAd?.sections ?? {}
    const text = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
      .map((key) => sections[key])
      .filter((section): section is { title?: string; text?: string } => Boolean(section?.text))
      .map((section) => [section.title, htmlToText(section.text)].filter(Boolean).join('\n'))
      .join('\n\n')
    return clampText(text)
  }
  return null
}

// ── Dispatch and detection ───────────────────────────────────────────────

export const ATS_KINDS: AtsKind[] = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'teamtailor',
  'recruitee',
  'personio',
  'bamboohr',
  'workday',
  'smartrecruiters',
  'factorial',
  'successfactors',
]

// null: the board does not exist. []: it exists and has no open offers.
export function readAtsBoard(ats: AtsKind, token: string, companyName: string): Promise<RawOpportunity[] | null> {
  switch (ats) {
    case 'greenhouse':
      return readGreenhouse(token, companyName)
    case 'lever':
      return readLever(token, companyName)
    case 'ashby':
      return readAshby(token, companyName)
    case 'workable':
      return readWorkable(token, companyName)
    case 'teamtailor':
      return readTeamtailor(token, companyName)
    case 'recruitee':
      return readRecruitee(token, companyName)
    case 'personio':
      return readPersonio(token, companyName)
    case 'bamboohr':
      return readBambooHr(token, companyName)
    case 'workday':
      return readWorkday(token, companyName)
    case 'smartrecruiters':
      return readSmartRecruiters(token, companyName)
    case 'factorial':
      return readFactorial(token, companyName)
    case 'successfactors':
      return readSuccessFactors(token, companyName)
  }
}

// The name a board gives its owner, where the ATS publishes one. Used to check
// that a board found by guessing the company's name really is that company's.
export async function boardOwner(ats: AtsKind, token: string): Promise<string | null> {
  switch (ats) {
    case 'greenhouse': {
      const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`, ats)) as { name?: string } | null
      return data?.name ?? null
    }
    case 'workable': {
      const data = (await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`, ats)) as { name?: string } | null
      return data?.name ?? null
    }
    case 'teamtailor': {
      const xml = await getText(`https://${token}/jobs.rss`, ats)
      return xml ? xmlTag(xmlTag(xml, 'channel') ?? '', 'title') : null
    }
    case 'recruitee': {
      const data = (await getJson(`https://${encodeURIComponent(token)}.recruitee.com/api/offers/`, ats)) as { offers?: RecruiteeOffer[] } | null
      return data?.offers?.[0]?.company_name ?? null
    }
    case 'personio': {
      const xml = await getText(`https://${encodeURIComponent(token)}.jobs.personio.de/xml`, ats)
      const subcompany = xml ? xmlTag(xml, 'subcompany') : null
      if (subcompany) return subcompany
      // Most feeds leave subcompany out; the board's page is titled "Jobs at <owner>".
      const html = await getText(`https://${encodeURIComponent(token)}.jobs.personio.de/`, ats)
      return html?.match(/<title>\s*(?:Jobs|Stellenangebote|Empleos|Ofertas de empleo)\s+(?:at|bei|en|de)\s+([^<]+?)\s*<\/title>/i)?.[1] ?? null
    }
    case 'smartrecruiters': {
      const data = (await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=1`, ats)) as {
        content?: SmartRecruitersPosting[]
      } | null
      return data?.content?.[0]?.company?.name ?? null
    }
    case 'successfactors': {
      // The feed is titled "<owner> - Custom Search", in the site's language.
      const parts = successFactorsParts(token)
      const xml = parts ? await getText(`https://${parts.host}/services/rss/job/?locale=en_US&keywords=&rows=1`, ats) : null
      const title = xml ? xmlTag(xmlTag(xml, 'channel') ?? '', 'title') : null
      return title?.replace(/\s+-\s+[^-]*$/, '').trim() || null
    }
    default:
      return null
  }
}

const GENERIC_NAME_WORDS = /\b(se|co|kg|ag|sa|bv|plc|group|grupo|technologies|technology|tech|labs|hq|careers|jobs|io|ai|app|com)\b/g

function compactName(name: string): string {
  return normaliseName(name).replace(GENERIC_NAME_WORDS, '').replace(/[^a-z0-9]+/g, '')
}

// "Personio SE & Co. KG" is Personio and "FeverUp" is Fever (feverup.com);
// "General Assembly Remote Jobs" is not Remote, "Trade Republic Customer
// Council" is not Trade Republic's hiring board and "Bolt.Works" is not Bolt.
// A feed title may carry a slogan after a dash ("Paack - WE Hire!").
export function sameCompany(owner: string, name: string, domain?: string | null): boolean {
  const domainStem = domain?.replace(/^www\./, '').split('.')[0]
  const wanted = [compactName(name), domainStem ? compactName(domainStem) : ''].filter(Boolean)
  return [owner, owner.split(/\s[-–—|:]\s/)[0]].some((form) => {
    const a = compactName(form)
    return a.length > 0 && wanted.includes(a)
  })
}

// prefix goes before the captured token: an EU Lever board is "eu:<site>".
export const BOARD_PATTERNS: { ats: AtsKind; pattern: RegExp; prefix?: string }[] = [
  { ats: 'greenhouse', pattern: /(?:boards(?:-api)?|job-boards(?:\.eu)?)\.greenhouse\.io\/(?:v1\/boards\/)?(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { ats: 'lever', pattern: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { ats: 'lever', pattern: /jobs\.eu\.lever\.co\/([a-z0-9_-]+)/i, prefix: LEVER_EU_PREFIX },
  { ats: 'ashby', pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i },
  { ats: 'workable', pattern: /apply\.workable\.com\/([a-z0-9_-]+)/i },
  { ats: 'teamtailor', pattern: /\b([a-z0-9-]+\.teamtailor\.com)\b/i },
  { ats: 'recruitee', pattern: /\b([a-z0-9-]+)\.recruitee\.com/i },
  { ats: 'personio', pattern: /\b([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i },
  { ats: 'bamboohr', pattern: /\b([a-z0-9-]+)\.bamboohr\.com/i },
  // tenant.wdN/site: the site is the path's first segment after an optional locale.
  { ats: 'workday', pattern: /\b([a-z0-9-]+\.wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/ },
  { ats: 'smartrecruiters', pattern: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i },
  { ats: 'factorial', pattern: /\b([a-z0-9-]+\.factorial(?:hr)?\.(?:com|co|es))\b/i },
]

export const NOT_TOKENS = new Set(['api', 'app', 'assets', 'careers-analytics', 'cdn', 'embed', 'j', 'jobs', 'static', 'v1', 'widget', 'www'])

// ATSs whose boards live on a per-company subdomain: a guessed token with a
// dot in it (the company's domain) cannot name one.
const SUBDOMAIN_ATS = new Set<AtsKind>(['teamtailor', 'recruitee', 'personio', 'bamboohr'])

// Workable answers a burst of guesses with a day-long ban (Retry-After: 85631
// on 2026-09-27, after one directory pass), which also stops reading the
// boards already watched there. BambooHR never names a board's owner, and
// short names are taken ("chorus" is a London firm, not Chorus One). Their
// boards are taken only from a careers page that links them, or pinned in the
// directory.
// A Workday token (tenant, server, site) cannot be guessed from a name at all,
// nor can a SuccessFactors site's host.
const NEVER_PROBED = new Set<AtsKind>(['workable', 'bamboohr', 'workday', 'successfactors'])

// Personio names the owner on most boards, not all; a guess there stands only
// when it does ("neon" is NEON, a German bank, not Neon).
const OWNER_REQUIRED = new Set<AtsKind>(['personio'])

export interface DetectedBoard {
  ats: AtsKind
  token: string
  openCount: number
  via: 'careers_page' | 'probe'
}

// Most careers pages embed an ATS. The page's own HTML names it when it is
// server-rendered; otherwise the company's name is tried against each API.
export async function detectBoard(params: { name: string; careersUrl?: string | null; domain?: string | null }): Promise<DetectedBoard | null> {
  if (params.careersUrl) {
    try {
      // A careers address may come from outside (the owner's tools, a
      // directory entry): it is read as any page someone gave us is.
      const response = await safeFetchText(params.careersUrl, { headers: { 'User-Agent': USER_AGENT }, timeoutMs: TIMEOUT_MS, maxBytes: CAREERS_PAGE_BYTES, maxRedirects: 5 })
      const html = response.status >= 200 && response.status < 300 ? response.body : ''
      const found: { ats: AtsKind; token: string }[] = []
      for (const { ats, pattern, prefix } of BOARD_PATTERNS) {
        for (const match of html.matchAll(new RegExp(pattern.source, ats === 'workday' ? 'g' : 'gi'))) {
          const token = ats === 'workday' ? `${match[1].toLowerCase()}/${match[2]}` : `${prefix ?? ''}${match[1]}`
          if (!NOT_TOKENS.has(match[1].split('.')[0].toLowerCase()) && !found.some((f) => f.ats === ats && f.token === token)) found.push({ ats, token })
        }
      }
      // A Teamtailor site on the company's own domain serves the same feed.
      if (/teamtailor/i.test(html) && response.url) found.push({ ats: 'teamtailor', token: new URL(response.url).host })
      // A SuccessFactors career site draws its pages from SAP's RMK CDN.
      if (/rmkcdn\.successfactors\.com/i.test(html) && response.url) found.push({ ats: 'successfactors', token: new URL(response.url).host })
      for (const { ats, token } of found) {
        const jobs = await readAtsBoard(ats, token, params.name).catch(() => null)
        if (jobs) return { ats, token, openCount: jobs.length, via: 'careers_page' }
      }
    } catch {
      // Unreachable careers page: fall through to probing.
    }
  }

  const base = params.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const domainStem = params.domain?.replace(/^www\./, '').split('.')[0]
  const candidates = [
    ...new Set([base.replace(/[^a-z0-9]+/g, ''), base.replace(/[^a-z0-9]+/g, '-'), domainStem, params.domain].filter(Boolean) as string[]),
  ]

  // A guessed name is weak evidence of identity. An empty board under it is
  // usually an unrelated or abandoned account (a "revolut" Workable with no
  // offers, a "mistral" Lever after Mistral moved to Ashby), so only a board
  // with open offers counts, and where the ATS names the board's owner, that
  // name must be the company's. Every guess is tried: a board whose owner is
  // confirmed wins, then the largest (a "fever" Personio with three offers is
  // not Fever, whose 500 offers are on Greenhouse as "feverup"). An empty
  // board is trusted only when the company's own careers page links to it.
  // Each guess is tried on every ATS at once (each its own host), one guess
  // after another (the same host is not asked several names at once).
  const hits: (DetectedBoard & { confirmed: boolean })[] = []
  for (const candidate of candidates) {
    const tried = await Promise.all(
      ATS_KINDS.filter((ats) => !NEVER_PROBED.has(ats) && !(SUBDOMAIN_ATS.has(ats) && candidate.includes('.'))).map(async (ats) => {
        const token = ats === 'teamtailor' ? `${candidate}.teamtailor.com` : candidate
        const jobs = await readAtsBoard(ats, token, params.name).catch(() => null)
        if (!jobs || jobs.length === 0) return null
        const owner = await boardOwner(ats, token).catch(() => null)
        if (owner ? !sameCompany(owner, params.name, params.domain) : OWNER_REQUIRED.has(ats)) return null
        return { ats, token, openCount: jobs.length, via: 'probe' as const, confirmed: owner !== null }
      }),
    )
    for (const hit of tried) if (hit) hits.push(hit)
  }
  hits.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.openCount - a.openCount)
  if (!hits.length) return null
  const { ats, token, openCount, via } = hits[0]
  return { ats, token, openCount, via }
}
