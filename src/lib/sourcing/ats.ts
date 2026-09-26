import { clampText, htmlToText, inferWorkplace } from './text'
import { SourceError, type AtsKind, type RawOpportunity, type Workplace } from './types'

// Public job-board APIs that companies use to power their own careers pages.
// Each returns the company's full current list, so an offer missing from a
// successful read has closed.

const TIMEOUT_MS = 20_000
const USER_AGENT = 'Amble/0.1 (+job sourcing for a single candidate)'

async function getJson(url: string, source: AtsKind): Promise<unknown | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal })
    if (response.status === 404) return null
    if (response.status === 429) throw new SourceError(`${source} rate limit reached`, source, 429)
    if (!response.ok) throw new SourceError(`${source} answered ${response.status}`, source, response.status)
    return await response.json()
  } catch (error) {
    if (error instanceof SourceError) throw error
    throw new SourceError(`${source} could not be read: ${error instanceof Error ? error.message : 'unknown error'}`, source)
  } finally {
    clearTimeout(timeout)
  }
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

async function readLever(token: string, companyName: string, region: 'global' | 'eu' = 'global'): Promise<RawOpportunity[] | null> {
  const host = region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'
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

// ── Dispatch and detection ───────────────────────────────────────────────

export const ATS_KINDS: AtsKind[] = ['greenhouse', 'lever', 'ashby', 'workable']

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
  }
}

const BOARD_PATTERNS: { ats: AtsKind; pattern: RegExp }[] = [
  { ats: 'greenhouse', pattern: /(?:boards(?:-api)?|job-boards(?:\.eu)?)\.greenhouse\.io\/(?:v1\/boards\/)?(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { ats: 'lever', pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i },
  { ats: 'ashby', pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i },
  { ats: 'workable', pattern: /apply\.workable\.com\/([a-z0-9_-]+)/i },
]

const NOT_TOKENS = new Set(['api', 'embed', 'j', 'jobs', 'v1', 'widget'])

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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const response = await fetch(params.careersUrl, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal, redirect: 'follow' })
      clearTimeout(timeout)
      const html = response.ok ? await response.text() : ''
      for (const { ats, pattern } of BOARD_PATTERNS) {
        const token = html.match(pattern)?.[1]
        if (!token || NOT_TOKENS.has(token.toLowerCase())) continue
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
  // with open offers counts. An empty board is trusted only when the company's
  // own careers page links to it (above).
  for (const token of candidates) {
    for (const ats of ATS_KINDS) {
      const jobs = await readAtsBoard(ats, token, params.name).catch(() => null)
      if (jobs && jobs.length > 0) return { ats, token, openCount: jobs.length, via: 'probe' }
    }
  }
  return null
}
