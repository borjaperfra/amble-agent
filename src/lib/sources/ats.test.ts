/**
 * Reading two applicant tracking systems, without either of them.
 *
 * The records below are the shape their public boards actually answer with,
 * trimmed. What is being pinned down is mostly restraint: Greenhouse gives a
 * location as free text and no pay at all, and the temptation is to read
 * "Hybrid - London" as hybrid and call it a fact. It is not one. Guessing
 * there would silently fail somebody on a hard constraint that nobody ever
 * stated — so the adapter leaves it null and the model reads the posting.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ashbyAdapter, departmentMatches, greenhouseAdapter } from './ats'
import { rubricFromFeed, type FeedOffer } from './types'
import { deterministicHardConstraints } from '@/domains/opportunity/rules'

const greenhouseJob = {
  id: 6136160004,
  title: 'Head of Growth Marketing',
  company_name: 'Vercel',
  absolute_url: 'https://job-boards.greenhouse.io/vercel/jobs/6136160004',
  location: { name: 'Hybrid - London' },
  departments: [{ id: 1, name: 'Marketing' }],
  offices: [{ name: 'Office - London' }],
  content:
    '&lt;p&gt;We are hiring a &lt;strong&gt;Head of Growth Marketing&lt;/strong&gt;.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Own the funnel&lt;/li&gt;&lt;li&gt;Own the team &amp;amp; the budget&lt;/li&gt;&lt;/ul&gt;',
}

const ashbyJob = {
  id: '0be1b52c-2401-4ae2-b7fc-5d018c1ff96f',
  title: 'Product Marketing Manager',
  department: 'Marketing',
  team: 'Product Marketing',
  employmentType: 'FullTime',
  location: 'Remote (EMEA)',
  secondaryLocations: ['Remote (UK)'],
  isRemote: true,
  workplaceType: 'Remote',
  isListed: true,
  jobUrl: 'https://jobs.ashbyhq.com/posthog/0be1b52c',
  descriptionPlain: 'PostHog is hiring a product marketer. You will own positioning and launches.',
  compensation: {
    compensationTierSummary: '€120K – €150K',
    compensationTiers: [
      {
        components: [
          { summary: '€120K – €150K', minValue: 120_000, maxValue: 150_000, currencyCode: 'EUR' },
        ],
      },
    ],
  },
}

/** Answer one canned payload, and count the requests while doing it. */
function stubFetch(payload: unknown) {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

// ─── Greenhouse ───────────────────────────────────────────────────────────

describe('greenhouse', () => {
  it('reads a board in one request, posting included', async () => {
    const stub = stubFetch({ jobs: [greenhouseJob] })
    try {
      const offers = await greenhouseAdapter('vercel').list()
      assert.equal(offers.length, 1)
      assert.match(stub.calls[0], /boards\/vercel\/jobs\?content=true/)

      const posting = await greenhouseAdapter('vercel').rawText(offers[0])
      // No second request: the listing already carried the description.
      assert.equal(stub.calls.length, 1)
      assert.match(posting, /Own the team & the budget/)
      assert.match(posting, /- Own the funnel/)
      assert.ok(!posting.includes('&lt;'), 'the escaped HTML is decoded, not shown')
      assert.ok(!posting.includes('<p>'), 'and the tags are gone')
    } finally {
      stub.restore()
    }
  })

  it('refuses to read a work model out of free text', async () => {
    const stub = stubFetch({ jobs: [greenhouseJob] })
    try {
      const [offer] = await greenhouseAdapter('vercel').list()
      // "Hybrid - London" is a string somebody typed, not a stated fact. The
      // rubric stage reads it; the free screen must not fail anyone on it.
      assert.equal(offer.workModel, null)
      assert.deepEqual(offer.locations, ['Hybrid - London'])
      assert.equal(offer.department, 'Marketing')

      const checks = deterministicHardConstraints(
        {
          salaryMin: 120_000,
          salaryCurrency: 'EUR',
          workMode: 'remote',
          location: 'Valencia',
          technologies: [],
          stages: [],
        },
        rubricFromFeed(offer),
      )
      assert.equal(checks.find((check) => check.id === 'hc_work_mode')?.verdict, 'UNKNOWN')
      assert.equal(checks.find((check) => check.id === 'hc_salary')?.verdict, 'UNKNOWN')
      assert.ok(!checks.some((check) => check.verdict === 'FAIL'))
    } finally {
      stub.restore()
    }
  })
})

// ─── Ashby ────────────────────────────────────────────────────────────────

describe('ashby', () => {
  it('takes the facts it does state, and states them', async () => {
    const stub = stubFetch({ jobs: [ashbyJob] })
    try {
      const [offer] = await ashbyAdapter('posthog').list()
      assert.equal(offer.sourceRef, 'ashby:posthog:0be1b52c-2401-4ae2-b7fc-5d018c1ff96f')
      assert.equal(offer.workModel, 'remote')
      assert.equal(offer.salaryMin, 120_000)
      assert.equal(offer.salaryMax, 150_000)
      assert.equal(offer.currency, 'EUR')
      assert.equal(offer.department, 'Marketing / Product Marketing')
      assert.deepEqual(offer.locations, ['Remote (EMEA)', 'Remote (UK)'])

      const posting = await ashbyAdapter('posthog').rawText(offer)
      assert.equal(stub.calls.length, 1)
      assert.match(posting, /Salary: 120\.000 – 150\.000 EUR per year/)
      assert.match(posting, /Work: fully remote/)
      assert.match(posting, /You will own positioning and launches/)
    } finally {
      stub.restore()
    }
  })

  it('leaves an unlisted job out', async () => {
    const stub = stubFetch({ jobs: [{ ...ashbyJob, isListed: false }] })
    try {
      const [offer] = await ashbyAdapter('posthog').list()
      assert.equal(offer.active, false)
    } finally {
      stub.restore()
    }
  })

  it('does not invent pay when the board keeps it to itself', async () => {
    const stub = stubFetch({ jobs: [{ ...ashbyJob, compensation: { compensationTiers: [] } }] })
    try {
      const [offer] = await ashbyAdapter('posthog').list()
      assert.equal(offer.salaryMin, null)
      assert.equal(offer.salaryMax, null)
    } finally {
      stub.restore()
    }
  })
})

// ─── The triage ───────────────────────────────────────────────────────────

describe('departmentMatches', () => {
  const offer = { department: 'Marketing / Product Marketing', role: 'Head of Growth' } as FeedOffer

  it('keeps everything when nothing was asked for', () => {
    assert.equal(departmentMatches(offer, []), true)
  })

  it('matches on what the board itself calls the team', () => {
    assert.equal(departmentMatches(offer, ['marketing']), true)
    assert.equal(departmentMatches(offer, ['engineering']), false)
  })

  it('will also take the title, for boards that file everything under one team', () => {
    const engineering = { department: 'Engineering', role: 'Head of Growth' } as FeedOffer
    assert.equal(departmentMatches(engineering, ['growth']), true)
  })
})
