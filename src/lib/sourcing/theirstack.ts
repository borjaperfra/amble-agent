import { clampText, inferWorkplace } from './text'
import { SourceError, type RawOpportunity, type Workplace } from './types'

// TheirStack aggregates postings from job boards (LinkedIn, Indeed, Glassdoor),
// ATSs and careers sites. It is the only clean route to offers that live on
// LinkedIn: LinkedIn has no search API and forbids scraping.
//
// Every job returned costs one credit, so filtering happens on their side and
// the query is kept narrow. Optional: without AMBLE_THEIRSTACK_API_KEY the
// source is simply skipped.

const ENDPOINT = 'https://api.theirstack.com/v1/jobs/search'
const TIMEOUT_MS = 30_000

export interface TheirStackQuery {
  titleAny: string[]
  titleNot?: string[]
  countryCodes?: string[]
  countryNot?: string[]
  seniority?: string[]
  directEmployersOnly?: boolean
  // Companies with at least this many people, or of unknown size.
  minEmployees?: number
  workplaces?: Workplace[]
  descriptionAny?: string[]
  maxAgeDays: number
  limit: number
}

interface TheirStackJob {
  id: number | string
  job_title: string
  url?: string | null
  final_url?: string | null
  source_url?: string | null
  date_posted?: string | null
  location?: string | null
  long_location?: string | null
  remote?: boolean | null
  hybrid?: boolean | null
  min_annual_salary_usd?: number | null
  max_annual_salary_usd?: number | null
  salary_string?: string | null
  description?: string | null
  company?: string | null
  company_domain?: string | null
  company_object?: { name?: string | null; domain?: string | null } | null
}

export function theirStackConfigured(): boolean {
  return Boolean(process.env.AMBLE_THEIRSTACK_API_KEY?.trim())
}

function workplaceOf(job: TheirStackJob): Workplace | null {
  if (job.remote) return 'remote'
  if (job.hybrid) return 'hybrid'
  return inferWorkplace(job.long_location ?? job.location) ?? (job.remote === false && job.hybrid === false ? 'onsite' : null)
}

const WORKPLACE_PARAM: Record<Workplace, string> = { remote: 'remote', hybrid: 'hybrid', onsite: 'on_site' }

const PAGE_SIZE = 25

async function fetchPage(apiKey: string, body: Record<string, unknown>): Promise<TheirStackJob[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    throw new SourceError(`TheirStack could not be reached: ${error instanceof Error ? error.message : 'unknown error'}`, 'theirstack')
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    // Their own message says what is wrong (a key, a plan limit, a filter);
    // a status code alone does not: a plan limit came back as 403.
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    const what =
      response.status === 401 ? 'rejected the API key' : response.status === 402 ? 'says credits are exhausted' : `answered ${response.status}`
    throw new SourceError(`TheirStack ${what}${detail ? `: ${detail}` : ''}`, 'theirstack', response.status)
  }
  const data = (await response.json()) as { data?: TheirStackJob[] }
  return data.data ?? []
}

export async function searchTheirStack(query: TheirStackQuery): Promise<RawOpportunity[]> {
  const apiKey = process.env.AMBLE_THEIRSTACK_API_KEY?.trim()
  if (!apiKey) throw new SourceError('AMBLE_THEIRSTACK_API_KEY is not set', 'theirstack')
  if (query.titleAny.length === 0) throw new SourceError('A TheirStack query needs at least one title pattern', 'theirstack')

  const body: Record<string, unknown> = {
    job_title_or: query.titleAny,
    posted_at_max_age_days: query.maxAgeDays,
    include_total_results: false,
  }
  if (query.titleNot?.length) body.job_title_not = query.titleNot
  if (query.countryCodes?.length) body.job_country_code_or = query.countryCodes
  if (query.countryNot?.length) body.job_country_code_not = query.countryNot
  if (query.seniority?.length) body.job_seniority_or = query.seniority
  if (query.directEmployersOnly) body.company_type = 'direct_employer'
  if (query.minEmployees) body.min_employee_count_or_null = query.minEmployees
  if (query.workplaces?.length) body.workplace_types_or = query.workplaces.map((w) => WORKPLACE_PARAM[w])
  if (query.descriptionAny?.length) body.job_description_pattern_or = query.descriptionAny

  // The free plan caps a page at 25 results, so a larger limit is read page by
  // page. A short page means there is nothing more to fetch.
  const jobs: TheirStackJob[] = []
  for (let page = 0; jobs.length < query.limit; page++) {
    const pageSize = Math.min(PAGE_SIZE, query.limit - jobs.length)
    const batch = await fetchPage(apiKey, { ...body, limit: pageSize, page })
    jobs.push(...batch)
    if (batch.length < pageSize) break
  }

  return jobs
    .filter((job) => job.job_title && (job.company_object?.name || job.company))
    .map((job) => {
      const location = job.long_location ?? job.location ?? null
      return {
        source: 'theirstack',
        externalId: String(job.id),
        companyName: (job.company_object?.name ?? job.company ?? '').trim(),
        companyDomain: job.company_object?.domain ?? job.company_domain ?? null,
        title: job.job_title.trim(),
        location,
        workplace: workplaceOf(job),
        // final_url points at the original posting (the company's ATS or
        // careers page), which lets it merge with what the ATS adapter reads.
        url: job.final_url ?? job.url ?? job.source_url ?? null,
        description: clampText(job.description),
        salaryMin: job.min_annual_salary_usd ? Math.round(job.min_annual_salary_usd) : null,
        salaryMax: job.max_annual_salary_usd ? Math.round(job.max_annual_salary_usd) : null,
        salaryCurrency: job.min_annual_salary_usd || job.max_annual_salary_usd ? 'USD' : null,
        salaryRaw: job.salary_string ?? null,
        postedAt: job.date_posted ? new Date(job.date_posted).toISOString() : null,
      }
    })
}
