import { clampText } from './text'
import { SourceError, type RawOpportunity, type Workplace } from './types'

// InfoJobs, through its official API (developer.infojobs.net): the largest
// job board in Spain, and the only one of its size with a search API. Free,
// with an application's credentials (AMBLE_INFOJOBS_CLIENT_ID and _SECRET);
// without them the source is skipped. The search lists offers without their
// text; an offer's text is read only when it is about to be judged.

const API = 'https://api.infojobs.net/api'
const TIMEOUT_MS = 20_000
const PER_TERM = 50

export function infoJobsConfigured(): boolean {
  return Boolean(process.env.AMBLE_INFOJOBS_CLIENT_ID?.trim() && process.env.AMBLE_INFOJOBS_CLIENT_SECRET?.trim())
}

function auth(): string {
  const id = process.env.AMBLE_INFOJOBS_CLIENT_ID?.trim() ?? ''
  const secret = process.env.AMBLE_INFOJOBS_CLIENT_SECRET?.trim() ?? ''
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: auth() }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error) => {
    throw new SourceError(`InfoJobs could not be reached: ${error instanceof Error ? error.message : 'unknown error'}`, 'infojobs')
  })
  if (!response.ok) throw new SourceError(`InfoJobs answered ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`, 'infojobs', response.status)
  return response.json()
}

export interface InfoJobsQuery {
  // Words for the job title, each its own search.
  terms: string[]
}

interface InfoJobsOffer {
  id: string
  title?: string
  link?: string
  city?: string
  province?: { value?: string }
  published?: string
  updated?: string
  teleworking?: { value?: string }
  salaryDescription?: string
  salaryMin?: { value?: string }
  salaryMax?: { value?: string }
  salaryPeriod?: { value?: string }
  author?: { name?: string }
}

function workplaceOf(value: string | undefined): Workplace | null {
  const text = (value ?? '').toLowerCase()
  if (text.includes('solo teletrabajo')) return 'remote'
  if (text.includes('híbrido') || text.includes('hibrido') || text.includes('parcial')) return 'hybrid'
  if (text.includes('presencial')) return 'onsite'
  return null
}

function yearly(amount: string | undefined, period: string | undefined): number | null {
  const figure = Number((amount ?? '').replace(/[^\d]/g, ''))
  if (!figure) return null
  // Monthly figures in Spain are fourteen payments.
  return /mes/i.test(period ?? '') ? figure * 14 : figure
}

export async function searchInfoJobs(query: InfoJobsQuery): Promise<RawOpportunity[]> {
  if (!infoJobsConfigured()) throw new SourceError('InfoJobs credentials are not set', 'infojobs')
  const byId = new Map<string, RawOpportunity>()
  for (const term of query.terms.slice(0, 5)) {
    const params = new URLSearchParams({ q: term, sinceDate: '_7_DAYS', maxResults: String(PER_TERM), order: 'updated-desc' })
    const data = (await get(`/9/offer?${params}`)) as { items?: InfoJobsOffer[] }
    for (const offer of data.items ?? []) {
      if (!offer.id || !offer.title || !offer.author?.name || byId.has(offer.id)) continue
      const period = offer.salaryPeriod?.value
      byId.set(offer.id, {
        source: 'infojobs',
        externalId: offer.id,
        companyName: offer.author.name.trim(),
        title: offer.title.trim(),
        location: [offer.city, offer.province?.value].filter(Boolean).join(', ') || null,
        workplace: workplaceOf(offer.teleworking?.value),
        url: offer.link ?? null,
        description: null,
        salaryMin: yearly(offer.salaryMin?.value, period),
        salaryMax: yearly(offer.salaryMax?.value, period),
        salaryCurrency: offer.salaryMin?.value || offer.salaryMax?.value ? 'EUR' : null,
        salaryRaw: offer.salaryDescription ?? null,
        postedAt: offer.published ? new Date(offer.published).toISOString() : null,
      })
    }
  }
  return [...byId.values()]
}

// The offer's text: description, then what it requires and what it prefers.
export async function describeInfoJobs(offerId: string): Promise<string | null> {
  const data = (await get(`/7/offer/${encodeURIComponent(offerId)}`)) as {
    description?: string
    minRequirements?: string
    desiredRequirements?: string
    teleworking?: { value?: string }
  }
  const parts = [
    data.description,
    data.minRequirements && `Requisitos mínimos:\n${data.minRequirements}`,
    data.desiredRequirements && `Requisitos deseados:\n${data.desiredRequirements}`,
    data.teleworking?.value && `Teletrabajo: ${data.teleworking.value}`,
  ].filter(Boolean)
  return clampText(parts.join('\n\n'))
}
