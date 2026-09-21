/**
 * Reading Manfred's public API, without Manfred.
 *
 * The fixtures below are the shape the API actually answers with, trimmed:
 * same field names, same units, same quirks. Those quirks are the whole
 * reason this file exists — `equityInf: 0` meaning none rather than zero
 * percent, a `remotePercentage` that is a share and not a mode, a currency
 * that is a glyph, `techs` graded MUST/SHOULD/COULD. Getting any of them
 * wrong would fail somebody on a number that was never there.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeRawText, offerFromListing, workModelFor } from './manfred'
import { rubricFromFeed, screenedText, type FeedOffer } from './types'
import { deterministicHardConstraints } from '@/domains/opportunity/rules'

const listed = {
  id: 8476,
  position: 'Head of Growth & Community',
  slug: 'halvard-head-of-growth',
  status: 'ACTIVE',
  salaryFrom: 130_000,
  salaryTo: 150_000,
  bonus: 0,
  remotePercentage: 100,
  equityInf: 0.8,
  equitySup: 1.2,
  currency: '€',
  highlights: ['🛸 Startup', '🕐 Horario Flexible'],
  locations: ['Valencia, España', 'Madrid, España'],
  offerLanguages: ['ES'],
  updatedAt: '2026-09-18T07:48:11.546Z',
  isFreelance: false,
  company: { name: 'Halvard', web: 'https://halvard.example' },
}

const detail = {
  ...listed,
  introduction: 'An EU inference platform for developers.',
  whatWillYouDo: 'You would own the whole picture.',
  responsibilities: ['Own how developers find us.', 'Own the community around the product.'],
  howWillYouDoIt: 'Small team, no theatre.',
  whatTheyAskFor: 'These are the essentials:',
  techs: [
    { name: 'Developer marketing', section: 'MUST', level: 'ADVANCED' },
    { name: 'SQL', section: 'COULD', level: 'BASIC' },
  ],
  softSkills: [{ name: 'Liderazgo' }],
  whenWillDoIt: 'Flexible.',
  whereWillDoIt: 'Anywhere in Europe.',
  whoWillDoItWith: 'Nineteen people.',
  whatOffering: 'Real equity and the roadmap for it.',
  perks: [{ name: 'Presupuesto para formación' }],
  inOneMonth: 'You will have shipped the first thing.',
  languages: [{ code: 'ES', name: 'Español', level: 'NativeBilingual' }],
  workingDayInfo: { isFullTime: true, hasFlexTime: true, annualHolidays: 25 },
}

const summary = offerFromListing(listed) as FeedOffer

// ─── One listing ──────────────────────────────────────────────────────────

describe('offerFromListing', () => {
  it('reads the offer out of the list', () => {
    assert.ok(summary)
    assert.equal(summary.sourceRef, 'manfred:8476')
    assert.equal(summary.company, 'Halvard')
    assert.equal(summary.role, 'Head of Growth & Community')
    assert.equal(summary.url, 'https://www.getmanfred.com/ofertas-empleo/8476/halvard-head-of-growth')
    assert.equal(summary.active, true)
  })

  it('takes money as whole euros and a glyph as a currency', () => {
    assert.equal(summary.salaryMin, 130_000)
    assert.equal(summary.salaryMax, 150_000)
    assert.equal(summary.currency, 'EUR')
  })

  it('treats a salary of zero as not stated, because that is what it means', () => {
    const quiet = offerFromListing({ ...listed, salaryFrom: 0, salaryTo: 0 })
    assert.equal(quiet?.salaryMin, null)
    assert.equal(quiet?.salaryMax, null)
  })

  it('treats zero equity as no equity rather than as a promise of none', () => {
    assert.equal(summary.equity, '0.8% – 1.2%')
    assert.equal(offerFromListing({ ...listed, equityInf: 0, equitySup: 0 })?.equity, null)
  })

  it('keeps every location the offer lists', () => {
    assert.deepEqual(summary.locations, ['Valencia, España', 'Madrid, España'])
  })

  it('knows a closed offer when it sees one', () => {
    assert.equal(offerFromListing({ ...listed, status: 'CLOSED' })?.active, false)
    assert.equal(offerFromListing({ ...listed, status: 'CANCELLED' })?.active, false)
  })

  it('gives up quietly on something that is not an offer', () => {
    assert.equal(offerFromListing({ id: 1 }), null)
    assert.equal(offerFromListing(null), null)
  })
})

// ─── The posting, put back together ───────────────────────────────────────

describe('composeRawText', () => {
  const text = composeRawText(summary, detail)

  it('states the numbers in words, so the rubric stage can read them', () => {
    assert.match(text, /130\.000 – 150\.000 EUR per year/)
    assert.match(text, /Equity: 0\.8% – 1\.2%/)
    assert.match(text, /fully remote/)
    assert.match(text, /Based in: Valencia, España; Madrid, España/)
    assert.match(text, /Working day: full time, flexible hours, 25 days of holiday/)
  })

  it('keeps the grading the feed already did on what it wants', () => {
    // MUST and COULD are the closest thing the source has to importance, and
    // throwing it away would make the rubric guess at what is required.
    assert.match(text, /- Developer marketing \(must have, advanced\)/)
    assert.match(text, /- SQL \(nice to have, basic\)/)
  })

  it('carries the posting itself, not a summary of it', () => {
    assert.match(text, /Own the community around the product/)
    assert.match(text, /Anywhere in Europe/)
    assert.match(text, /Nineteen people/)
    assert.match(text, /You will have shipped the first thing/)
  })

  it('says a missing number is missing rather than leaving it out', () => {
    const quiet = composeRawText(
      offerFromListing({ ...listed, salaryFrom: 0, salaryTo: 0, equityInf: 0, equitySup: 0 })!,
      {},
    )
    assert.match(quiet, /Salary: not stated/)
    assert.match(quiet, /Equity: not mentioned/)
  })

  it('says outright when an offer was never read past the list', () => {
    const screened = screenedText(summary)
    assert.match(screened, /130\.000 – 150\.000 EUR/)
    assert.match(screened, /Not read any further/)
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
  const failuresFor = (raw: unknown) =>
    deterministicHardConstraints(constraints, rubricFromFeed(offerFromListing(raw)!)).filter(
      (check) => check.verdict === 'FAIL',
    )

  it('maps a remote share to how much presence is being asked for', () => {
    assert.equal(workModelFor(100), 'remote')
    assert.equal(workModelFor(40), 'hybrid')
    assert.equal(workModelFor(0), 'onsite')
    assert.equal(workModelFor(null), null)
  })

  it('lets a good offer through untouched', () => {
    assert.deepEqual(failuresFor(listed), [])
  })

  it('drops one that pays under the floor before anything is downloaded', () => {
    const failed = failuresFor({ ...listed, salaryFrom: 35_000, salaryTo: 45_000 })
    assert.equal(failed.length, 1)
    assert.equal(failed[0].id, 'hc_salary')
  })

  it('drops one that wants four days in an office', () => {
    assert.equal(failuresFor({ ...listed, remotePercentage: 20 })[0]?.id, 'hc_work_mode')
  })

  it('marca la que se queda a un palmo, sin dejarla pasar', () => {
    // 110.000 contra un suelo de 120.000: cae igual —el suelo es suyo— pero
    // deja de ser indistinguible de una de 35.000, que es lo único que puede
    // decirle algún día que su propio suelo le está costando cosas.
    const failed = failuresFor({ ...listed, salaryFrom: 100_000, salaryTo: 110_000 })
    assert.equal(failed[0]?.id, 'hc_salary')
    assert.equal(failed[0]?.verdict, 'FAIL', 'sigue cayendo')
    assert.equal(failed[0]?.near, true)
  })

  it('y no marca la que no se queda cerca de nada', () => {
    const failed = failuresFor({ ...listed, salaryFrom: 35_000, salaryTo: 45_000 })
    assert.equal(failed[0]?.near, undefined)
  })

  it('never fails an offer for being quiet about what it pays', () => {
    const checks = deterministicHardConstraints(
      constraints,
      rubricFromFeed(offerFromListing({ ...listed, salaryFrom: 0, salaryTo: 0 })!),
    )
    assert.equal(checks.find((check) => check.id === 'hc_salary')?.verdict, 'UNKNOWN')
  })
})
