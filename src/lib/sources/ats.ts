/**
 * The boards startups actually post on.
 *
 * Almost nobody publishes jobs on their own website any more; they publish
 * to an applicant tracking system and embed its board. Those systems serve
 * the same data as JSON, publicly, because that is how the embed works:
 *
 *   https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true
 *   https://api.ashbyhq.com/posting-api/job-board/{company}?includeCompensation=true
 *
 * One request per company, and both hand over the whole posting in it, so
 * there is no second round trip at all.
 *
 * The catch is what they do not hand over: neither reliably states salary,
 * and Greenhouse gives location as free text ("Hybrid - London"). So the
 * free screen has almost nothing to work with here — which is why these
 * adapters filter on the feed's own department instead. That is the source's
 * classification, not our guess at what a job title means; deciding that
 * "Head of Growth" is marketing and "Growth Engineer" is not, from the
 * string, is exactly the kind of precision this project keeps refusing to
 * pretend it has.
 */

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

// ─── Greenhouse ───────────────────────────────────────────────────────────

const GREENHOUSE = 'https://boards-api.greenhouse.io/v1/boards'

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

const unescape = (value: string) =>
  value.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (match) => ENTITIES[match])

/**
 * Greenhouse serves HTML that has itself been escaped, so it takes two
 * passes: one to get the markup back, and one for the entities that were
 * inside that markup all along. Stopping after the first leaves "&amp;"
 * sitting in the middle of a sentence, which is how you can tell nobody ever
 * read the output.
 */
function fromHtml(value: unknown): string | null {
  const escaped = asText(value)
  if (!escaped) return null
  const text = unescape(escaped)
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const plain = unescape(text)
  return plain.length > 0 ? plain : null
}

export function greenhouseAdapter(board: string): FeedAdapter {
  const source = `greenhouse:${board}`
  return {
    source,
    async list() {
      const payload = asRecord(await getJson(`${GREENHOUSE}/${board}/jobs?content=true`))
      return asArray(payload.jobs)
        .map((entry) => offerFromGreenhouse(source, board, entry))
        .filter((offer): offer is FeedOffer => offer !== null)
    },
    async rawText(offer) {
      const job = asRecord(offer.raw)
      return [
        `# ${offer.role} — ${offer.company}`,
        '',
        '## The facts as posted',
        ...factsBlock(offer),
        '',
        '## The posting',
        fromHtml(job.content) ?? '(The board gave no description.)',
      ]
        .join('\n')
        .slice(0, 14_000)
    },
  }
}

function offerFromGreenhouse(source: string, board: string, raw: unknown): FeedOffer | null {
  const job = asRecord(raw)
  const id = job.id ?? job.internal_job_id
  const role = asText(job.title)
  if (id === undefined || id === null || !role) return null

  const location = asText(asRecord(job.location).name)
  const department = asArray(job.departments)
    .map((entry) => asText(asRecord(entry).name))
    .filter((name): name is string => name !== null)
    .join(' / ')

  return {
    sourceRef: `${source}:${id}`,
    source,
    // The board name is the company: Greenhouse leaves company_name blank on
    // plenty of boards, and "vercel" is more use than nothing.
    company: asText(job.company_name) ?? board,
    role,
    url: asText(job.absolute_url) ?? `https://job-boards.greenhouse.io/${board}`,
    // Greenhouse states none of this. The rubric stage reads it out of the
    // posting, and the screen leaves it unknown rather than assuming.
    salaryMin: null,
    salaryMax: null,
    currency: null,
    workModel: null,
    locations: location ? [location] : [],
    equity: null,
    department: department.length > 0 ? department : null,
    active: true,
    raw: job,
  }
}

// ─── Ashby ────────────────────────────────────────────────────────────────

const ASHBY = 'https://api.ashbyhq.com/posting-api/job-board'

export function ashbyAdapter(board: string): FeedAdapter {
  const source = `ashby:${board}`
  return {
    source,
    async list() {
      const payload = asRecord(
        await getJson(`${ASHBY}/${encodeURIComponent(board)}?includeCompensation=true`),
      )
      return asArray(payload.jobs)
        .map((entry) => offerFromAshby(source, board, entry))
        .filter((offer): offer is FeedOffer => offer !== null)
    },
    async rawText(offer) {
      const job = asRecord(offer.raw)
      const extra: string[] = []
      const employment = asText(job.employmentType)
      if (employment) extra.push(`Employment: ${employment}.`)
      const summary = asText(asRecord(job.compensation).compensationTierSummary)
      if (summary) extra.push(`Compensation, as the board states it: ${summary}.`)

      return [
        `# ${offer.role} — ${offer.company}`,
        '',
        '## The facts as posted',
        ...factsBlock(offer, extra),
        '',
        '## The posting',
        asText(job.descriptionPlain) ?? '(The board gave no description.)',
      ]
        .join('\n')
        .slice(0, 14_000)
    },
  }
}

function offerFromAshby(source: string, board: string, raw: unknown): FeedOffer | null {
  const job = asRecord(raw)
  const id = asText(job.id)
  const role = asText(job.title)
  if (!id || !role) return null

  const locations = [asText(job.location), ...asArray(job.secondaryLocations).map(asText)].filter(
    (value): value is string => value !== null,
  )

  // Ashby states this one properly, so it counts as a fact. `workplaceType`
  // is the newer field and `isRemote` the older; either will do.
  const workplace = asText(job.workplaceType)?.toLowerCase()
  const workModel =
    workplace === 'remote' || job.isRemote === true
      ? ('remote' as const)
      : workplace === 'hybrid'
        ? ('hybrid' as const)
        : workplace === 'onsite'
          ? ('onsite' as const)
          : null

  const tier = asArray(asRecord(job.compensation).compensationTiers)[0]
  const components = asArray(asRecord(tier).components)
  const salary = components
    .map((entry) => asRecord(entry))
    .find((component) => asText(component.summary) !== null && component.minValue !== undefined)

  return {
    sourceRef: `${source}:${id}`,
    source,
    company: board,
    role,
    url: asText(job.jobUrl) ?? `https://jobs.ashbyhq.com/${board}`,
    salaryMin: annualSalary(salary?.minValue),
    salaryMax: annualSalary(salary?.maxValue),
    currency: currencyOf(salary?.currencyCode),
    workModel,
    locations,
    equity: null,
    department: [asText(job.department), asText(job.team)]
      .filter((value): value is string => value !== null)
      .join(' / ') || null,
    active: job.isListed !== false,
    raw: job,
  }
}

// ─── What is configured ───────────────────────────────────────────────────

/**
 * The boards to read, from `AMBLE_ATS_BOARDS`:
 *
 *   AMBLE_ATS_BOARDS=greenhouse:vercel,ashby:posthog,greenhouse:anthropic
 *
 * A list rather than a crawl, on purpose. Amble is not trying to see every
 * job in the world — it is watching the companies one person would actually
 * go and work for.
 */
export function configuredAtsAdapters(): FeedAdapter[] {
  const raw = process.env.AMBLE_ATS_BOARDS?.trim()
  if (!raw) return []

  const adapters: FeedAdapter[] = []
  for (const entry of raw.split(',')) {
    const [kind, board] = entry.trim().split(':')
    if (!board) continue
    if (kind === 'greenhouse') adapters.push(greenhouseAdapter(board.trim()))
    if (kind === 'ashby') adapters.push(ashbyAdapter(board.trim()))
  }
  return adapters
}

/**
 * Which of the feed's own departments are worth reading.
 *
 * Without this a board like Anthropic's is six hundred jobs, none of them
 * screenable on pay, and one click becomes ten hours of reasoning about
 * roles nobody was ever going to take.
 */
export function configuredDepartments(): string[] {
  return (process.env.AMBLE_ATS_DEPARTMENTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

export function departmentMatches(offer: FeedOffer, wanted: string[]): boolean {
  if (wanted.length === 0) return true
  const haystack = `${offer.department ?? ''} ${offer.role}`.toLowerCase()
  return wanted.some((word) => haystack.includes(word))
}
