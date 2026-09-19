/**
 * Reading Manfred's feed, without Manfred.
 *
 * The fixture below is the shape of a real offer page, trimmed: same field
 * names, same units, same quirks. Those quirks are the whole reason this
 * file exists — a salary stored as `35`, a `remote` that is a percentage
 * rather than a mode, a currency that is a glyph, and lists of `{id, item}`
 * where you would expect strings. Getting any of them wrong would fail
 * somebody on a number that was never there.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  composeRawText,
  offerUrls,
  parseOfferPage,
  rubricFromFeed,
  workModelFor,
} from './manfred'
import { deterministicHardConstraints } from '@/domains/opportunity/rules'

const offer = {
  slug: 'halvard-head-of-growth-sept26',
  id: 8476,
  title: 'Head of Growth & Community',
  company: 'Halvard',
  companyUrl: 'https://halvard.example',
  url: '/8476/halvard-head-of-growth-sept26',
  badges: [
    { id: '0', item: '🛸 Startup' },
    { id: '1', item: '🕐 Horario Flexible' },
  ],
  equityInf: 0.8,
  equitySup: 1.2,
  currency: '€',
  salaryMin: 130,
  salaryMax: 150,
  remote: 100,
  active: true,
  status: 'ACTIVE',
  updatedAt: '2026-09-18T07:48:11.546Z',
  locationsSummary: {
    trimmedCities: ['Valencia'],
    extraCities: ['Madrid'],
  },
  heroSectionData: { jobDescription: 'An EU inference platform for developers.' },
  requirementsSectionData: {
    requirementsIntro: 'You would own the whole picture.',
    responsabilities: [
      { id: 'r0', item: 'Own how developers find us.' },
      { id: 'r1', item: 'Own the community around the product.' },
    ],
  },
  skillsSectionData: {
    intro: 'These are the essentials:',
    skills: [{ id: 's0', item: 'You have grown a developer audience.' }],
    softSkills: [{ id: 's1', item: 'You can write.' }],
  },
  howSectionData: { howIntro: 'Small team, no theatre.', howItems: [] },
  whenSectionData: {
    whenIntro: 'Flexible.',
    highlights: [{ title: 'Vacaciones', value: '25 días' }],
  },
  whereSectionData: { jobInfo: 'Anywhere in Europe.' },
  teamSectionData: { teamInfo: 'Nineteen people.' },
  offerSectionData: { offerInfo: 'Real equity and the roadmap for it.' },
}

function pageWith(data: unknown): string {
  return `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    { props: { pageProps: { offer: data } } },
  )}</script></body></html>`
}

// ─── The sitemap ──────────────────────────────────────────────────────────

describe('offerUrls', () => {
  it('takes the offer pages and leaves everything else', () => {
    const urls = offerUrls(`<urlset>
      <url><loc>https://www.getmanfred.com/ofertas-empleo/8476/halvard-head-of-growth</loc></url>
      <url><loc>https://www.getmanfred.com/ofertas-empleo</loc></url>
      <url><loc>https://www.getmanfred.com/blog/something</loc></url>
    </urlset>`)
    assert.deepEqual(urls, ['https://www.getmanfred.com/ofertas-empleo/8476/halvard-head-of-growth'])
  })
})

// ─── One offer ────────────────────────────────────────────────────────────

describe('parseOfferPage', () => {
  it('reads the posting out of the page', () => {
    const parsed = parseOfferPage(pageWith(offer))
    assert.ok(parsed)
    assert.equal(parsed.sourceRef, 'manfred:8476')
    assert.equal(parsed.company, 'Halvard')
    assert.equal(parsed.title, 'Head of Growth & Community')
    assert.equal(parsed.url, 'https://www.getmanfred.com/ofertas-empleo/8476/halvard-head-of-growth-sept26')
    assert.equal(parsed.active, true)
  })

  it('reads money in the units the feed actually stores it in', () => {
    const parsed = parseOfferPage(pageWith(offer))
    // 130 in the feed is 130.000 a year. Taking it literally would fail this
    // candidate on every offer Manfred has ever published.
    assert.equal(parsed?.salaryMin, 130_000)
    assert.equal(parsed?.salaryMax, 150_000)
    assert.equal(parsed?.currency, 'EUR')
  })

  it('treats a salary of zero as not stated, because that is what it means', () => {
    const parsed = parseOfferPage(pageWith({ ...offer, salaryMin: 0, salaryMax: 0 }))
    assert.equal(parsed?.salaryMin, null)
    assert.equal(parsed?.salaryMax, null)
  })

  it('keeps every city, not just the ones the card had room for', () => {
    assert.deepEqual(parseOfferPage(pageWith(offer))?.locations, ['Valencia', 'Madrid'])
  })

  it('knows a closed offer when it sees one', () => {
    assert.equal(parseOfferPage(pageWith({ ...offer, active: false }))?.active, false)
    assert.equal(parseOfferPage(pageWith({ ...offer, status: 'CLOSED' }))?.active, false)
  })

  it('gives up quietly on a page that is not an offer', () => {
    assert.equal(parseOfferPage('<html><body>nothing here</body></html>'), null)
    assert.equal(parseOfferPage(pageWith({ id: 1 })), null)
  })
})

// ─── The posting, put back together ───────────────────────────────────────

describe('composeRawText', () => {
  const text = composeRawText(offer)

  it('states the numbers in words, so the rubric stage can read them', () => {
    assert.match(text, /130\.000 – 150\.000 EUR per year/)
    assert.match(text, /Equity: 0\.8% – 1\.2%/)
    assert.match(text, /fully remote/)
    assert.match(text, /Based in: Valencia, Madrid/)
  })

  it('says a missing number is missing rather than leaving it out', () => {
    // An unstated salary must reach the rubric as unstated: silence there
    // would come back as an unknown anyway, but a wrong guess would not.
    const quiet = composeRawText({ ...offer, salaryMin: 0, salaryMax: 0, equityInf: null, equitySup: null })
    assert.match(quiet, /Salary: not stated/)
    assert.match(quiet, /Equity: not mentioned/)
  })

  it('carries the posting itself, not a summary of it', () => {
    assert.match(text, /Own the community around the product/)
    assert.match(text, /You have grown a developer audience/)
    assert.match(text, /Anywhere in Europe/)
    assert.match(text, /Nineteen people/)
  })
})

// ─── What can be settled before spending anything ─────────────────────────

describe('the free screen', () => {
  const constraints = {
    salaryMin: 120_000,
    salaryCurrency: 'EUR',
    workMode: 'remote' as const,
    location: 'Valencia',
    technologies: [],
    stages: [],
  }

  it('maps a remote share to how much presence is being asked for', () => {
    assert.equal(workModelFor(100), 'remote')
    assert.equal(workModelFor(40), 'hybrid')
    assert.equal(workModelFor(0), 'onsite')
    assert.equal(workModelFor(null), null)
  })

  it('lets a good offer through untouched', () => {
    const parsed = parseOfferPage(pageWith(offer))
    const failed = deterministicHardConstraints(constraints, rubricFromFeed(parsed!)).filter(
      (check) => check.verdict === 'FAIL',
    )
    assert.deepEqual(failed, [])
  })

  it('drops one that pays under the floor before a model ever sees it', () => {
    const parsed = parseOfferPage(pageWith({ ...offer, salaryMin: 35, salaryMax: 45 }))
    const failed = deterministicHardConstraints(constraints, rubricFromFeed(parsed!)).filter(
      (check) => check.verdict === 'FAIL',
    )
    assert.equal(failed.length, 1)
    assert.equal(failed[0].id, 'hc_salary')
  })

  it('drops one that wants four days in an office', () => {
    const parsed = parseOfferPage(pageWith({ ...offer, remote: 20 }))
    const failed = deterministicHardConstraints(constraints, rubricFromFeed(parsed!)).filter(
      (check) => check.verdict === 'FAIL',
    )
    assert.equal(failed[0]?.id, 'hc_work_mode')
  })

  it('never fails an offer for being quiet about what it pays', () => {
    const parsed = parseOfferPage(pageWith({ ...offer, salaryMin: 0, salaryMax: 0 }))
    const checks = deterministicHardConstraints(constraints, rubricFromFeed(parsed!))
    assert.equal(checks.find((check) => check.id === 'hc_salary')?.verdict, 'UNKNOWN')
  })
})
