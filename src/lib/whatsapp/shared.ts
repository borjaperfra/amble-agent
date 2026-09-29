import { getDb } from '../db/db'
import { insertMatch, type MatchRow } from '../db/matching'
import { recordSighting, upsertCompany } from '../db/opportunities'
import { now } from '../db/repo'
import { assessOpportunity, type Explanation, type Gate } from '../matching/assess'
import { buildMatchingProfile } from '../matching/profile'
import { roleQueryFor } from '../matching/role-query'
import { currentMatchKey } from '../matching/run'
import { clampText, htmlToText, inferWorkplace, normaliseUrl } from '../sourcing/text'
import type { RawOpportunity } from '../sourcing/types'

// An offer someone brings to the Rep: a link they were sent (by a recruiter,
// a friend, a board) or its text pasted in. It is read, judged by the same
// assessor as everything amble finds, kept like any other offer (so it is in
// the app too), and answered with the verdict and the same buttons.

const TIMEOUT_MS = 15_000
const MIN_TEXT = 400

interface JobPostingLd {
  '@type'?: string | string[]
  title?: string
  description?: string
  datePosted?: string
  hiringOrganization?: { name?: string; sameAs?: string } | string
  jobLocation?: unknown
  jobLocationType?: string
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } }
}

function isJobPosting(node: unknown): node is JobPostingLd {
  if (!node || typeof node !== 'object') return false
  const type = (node as JobPostingLd)['@type']
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))
}

// The JobPosting most boards publish for search engines, wherever it sits.
function findJobPosting(html: string): JobPostingLd | null {
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]) as unknown
      const nodes = Array.isArray(data) ? data : [data, ...(((data as { '@graph'?: unknown[] })['@graph'] ?? []) as unknown[])]
      const found = nodes.find(isJobPosting)
      if (found) return found
    } catch {
      // A malformed block: the next one may do.
    }
  }
  return null
}

function places(location: unknown): string | null {
  const list = Array.isArray(location) ? location : location ? [location] : []
  const names = list
    .map((item) => {
      const address = (item as { address?: Record<string, string> })?.address ?? {}
      return [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ')
    })
    .filter(Boolean)
  return names.length ? [...new Set(names)].join(' · ') : null
}

function meta(html: string, property: string): string | null {
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
  return match?.[1]?.trim() ?? null
}

// An offer amble already knows by that link: nothing to fetch.
function knownOffer(url: string): RawOpportunity | null {
  const norm = normaliseUrl(url)
  if (!norm) return null
  const row = getDb()
    .prepare('SELECT o.*, c.name AS company_name FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.url_norm = ? LIMIT 1')
    .get(norm) as
    | { title: string; company_name: string; location: string | null; workplace: RawOpportunity['workplace']; url: string | null; description: string | null; salary_min: number | null; salary_max: number | null; salary_currency: string | null; salary_raw: string | null; posted_at: string | null }
    | undefined
  if (!row) return null
  return {
    source: 'shared',
    externalId: url,
    companyName: row.company_name,
    title: row.title,
    location: row.location,
    workplace: row.workplace,
    url: row.url ?? url,
    description: row.description,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryRaw: row.salary_raw,
    postedAt: row.posted_at,
  }
}

// Boards whose pages are drawn in the browser, read through the API amble
// already reads their boards with.
async function fromBoardApi(url: string): Promise<RawOpportunity | null> {
  const greenhouse = url.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i)
  if (greenhouse) {
    const data = (await fetch(`https://boards-api.greenhouse.io/v1/boards/${greenhouse[1]}/jobs/${greenhouse[2]}?content=true`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as { title?: string; location?: { name?: string }; content?: string; company_name?: string; updated_at?: string } | null
    if (!data?.title) return null
    const content = (data.content ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    return {
      source: 'shared',
      externalId: url,
      companyName: data.company_name ?? greenhouse[1],
      title: data.title,
      location: data.location?.name ?? null,
      workplace: inferWorkplace(data.location?.name ?? null),
      url,
      description: clampText(htmlToText(content)),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: null,
    }
  }
  const lever = url.match(/jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)\/([0-9a-f-]{36})/i)
  if (lever) {
    const data = (await fetch(`https://api.lever.co/v0/postings/${lever[1]}/${lever[2]}?mode=json`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as { text?: string; categories?: { location?: string }; descriptionPlain?: string; additionalPlain?: string; workplaceType?: string } | null
    if (!data?.text) return null
    return {
      source: 'shared',
      externalId: url,
      companyName: lever[1],
      title: data.text,
      location: data.categories?.location ?? null,
      workplace: data.workplaceType === 'remote' ? 'remote' : data.workplaceType === 'hybrid' ? 'hybrid' : inferWorkplace(data.categories?.location ?? null),
      url,
      description: clampText([data.descriptionPlain, data.additionalPlain].filter(Boolean).join('\n\n')),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryRaw: null,
      postedAt: null,
    }
  }
  return null
}

// What a link shows: an offer, when there is enough of one to judge.
export async function readSharedLink(url: string): Promise<RawOpportunity | null> {
  const known = knownOffer(url)
  if (known?.description) return known
  const viaApi = await fromBoardApi(url)
  if (viaApi) return viaApi
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null)
  if (!response?.ok) return null
  const html = await response.text().catch(() => '')
  const host = new URL(response.url || url).hostname.replace(/^www\./, '')
  const posting = findJobPosting(html)
  if (posting?.title) {
    const organisation = typeof posting.hiringOrganization === 'string' ? posting.hiringOrganization : posting.hiringOrganization?.name
    const salary = posting.baseSalary?.value
    const perMonth = /month/i.test(salary?.unitText ?? '')
    const yearly = (value?: number) => (value ? Math.round(perMonth ? value * 14 : value) : null)
    const location = places(posting.jobLocation)
    return {
      source: 'shared',
      externalId: url,
      companyName: (organisation ?? meta(html, 'og:site_name') ?? host).trim(),
      title: posting.title.trim(),
      location,
      workplace: posting.jobLocationType === 'TELECOMMUTE' ? 'remote' : inferWorkplace(location),
      url: response.url || url,
      description: clampText(htmlToText(posting.description ?? null)),
      salaryMin: yearly(salary?.minValue ?? salary?.value),
      salaryMax: yearly(salary?.maxValue ?? salary?.value),
      salaryCurrency: salary ? (posting.baseSalary?.currency ?? null) : null,
      salaryRaw: null,
      postedAt: posting.datePosted ? new Date(posting.datePosted).toISOString() : null,
    }
  }
  // No structured posting: the page's own text, if there is enough of it.
  const body = htmlToText(html.match(/<body[\s\S]*<\/body>/i)?.[0]?.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, '') ?? null)
  const title = meta(html, 'og:title') ?? html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim()
  if (!body || body.length < MIN_TEXT || !title) return null
  return {
    source: 'shared',
    externalId: url,
    companyName: meta(html, 'og:site_name') ?? host,
    title,
    location: null,
    workplace: null,
    url: response.url || url,
    description: clampText(body),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryRaw: null,
    postedAt: null,
  }
}

// The text of an offer, pasted in, with the company and title the agent read from it.
export function pastedOffer(text: string, company: string, title: string): RawOpportunity {
  return {
    source: 'shared',
    externalId: `pasted:${Buffer.from(text.slice(0, 200)).toString('base64url').slice(0, 40)}`,
    companyName: company || 'Oferta compartida',
    title: title || text.split('\n')[0].slice(0, 120),
    location: null,
    workplace: inferWorkplace(text),
    url: null,
    description: clampText(text),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryRaw: null,
    postedAt: null,
  }
}

export interface SharedVerdict {
  match: MatchRow
  explanation: Explanation
  gates: Gate[]
  title: string
  company: string
}

// Kept as an offer, judged against their profile (once: the same offer
// shared again is not judged twice), and the verdict returned.
export async function judgeShared(candidateId: string, raw: RawOpportunity): Promise<SharedVerdict> {
  const company = upsertCompany({ name: raw.companyName, domain: null, status: 'unresolved', discoveredVia: 'shared' })
  const { opportunityId } = recordSighting(raw, company.id, now())
  const key = currentMatchKey(candidateId)
  const db = getDb()
  const existing = () =>
    db.prepare('SELECT * FROM opportunity_matches WHERE candidate_id = ? AND opportunity_id = ? AND profile_hash = ?').get(candidateId, opportunityId, key) as
      | MatchRow
      | undefined
  if (!existing()) {
    const opportunity = db
      .prepare('SELECT o.*, c.name AS company_name FROM opportunities o JOIN companies c ON c.id = o.company_id WHERE o.id = ?')
      .get(opportunityId) as unknown as Parameters<typeof assessOpportunity>[0]['opportunity']
    const profile = buildMatchingProfile(candidateId)
    const query = await roleQueryFor(candidateId, profile)
    const assessment = await assessOpportunity({ candidateId, opportunity, profile, query })
    insertMatch({
      candidateId,
      opportunityId,
      profileHash: key,
      verdict: assessment.verdict,
      gates: assessment.gates,
      explanation: assessment.explanation,
      dropped: assessment.dropped,
      modelRunId: assessment.modelRunId,
    })
  }
  const match = existing() as MatchRow
  return { match, explanation: JSON.parse(match.explanation) as Explanation, gates: JSON.parse(match.gates) as Gate[], title: raw.title, company: raw.companyName }
}
