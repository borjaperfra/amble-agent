import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { CHROME } from './chrome'
import { DATA_DIRECTORY, getDb } from '../db/db'
import { setProgress } from '../db/matching'
import { applicationCv, questionKey, saveAnswer, savedAnswers } from './answers'
import { getPreparedApplication, type PreparedAnswer } from './prepare'

// Filling an application form from a browser amble opens, and sending it only
// when the candidate says so. The page stays open between the two, for a
// while: what is sent is exactly what they saw.
//
// It fills what it knows (facts, what the Rep wrote, what they answered) and
// leaves the rest; it never guesses a field it cannot place.

// Where the candidate is at their computer (development, for now), the form
// opens in a window they see: amble fills what it knows and they finish it
// and send it there. On a server, it is filled out of sight and they approve
// a picture of it.
const HEADED = process.env.AMBLE_BROWSER_HEADED === '1' || (process.env.NODE_ENV !== 'production' && process.env.AMBLE_BROWSER_HEADED !== '0')
// A rehearsal, for development: fills what it can but attaches no file (a
// form may upload one the moment it is attached) and does not wait for every
// required answer. Sending is refused.
const DRY = process.env.AMBLE_FILL_DRY === '1'
// A window they finish by hand gets longer than a form waiting for a yes.
const SESSION_MINUTES = HEADED ? 45 : 20
const NAVIGATION_MS = 45_000
const SUBMIT_WAIT_MS = 25_000

interface Session {
  browser: Browser
  page: Page
  expires: number
  // A window the candidate finishes: whether they sent it or closed it.
  state: 'open' | 'sent' | 'closed'
}

declare global {
  var __ambleApplySessions: Map<string, Session> | undefined
}

const sessions = (globalThis.__ambleApplySessions ??= new Map<string, Session>())
const sessionKey = (candidateId: string, opportunityId: string) => `${candidateId}:${opportunityId}`

async function closeSession(key: string) {
  const session = sessions.get(key)
  sessions.delete(key)
  await session?.browser.close().catch(() => undefined)
}

// Forms left open are closed after a while, whatever happened to them.
setInterval(() => {
  for (const [key, session] of sessions) if (session.expires < Date.now()) void closeSession(key)
}, 60_000).unref?.()

export type FillResult =
  | { status: 'filled'; filled: string[]; left: string[]; captcha: boolean; window: boolean }
  | { status: 'missing'; missing: string[] }
  | { status: 'unavailable'; reason: string }

interface OfferRow {
  source: string
  external_id: string
  url: string | null
  ats_token: string | null
  title: string
}

function applyUrl(offer: OfferRow): string | null {
  if (offer.source === 'ashby' && offer.ats_token) return `https://jobs.ashbyhq.com/${offer.ats_token}/${offer.external_id}/application`
  if (offer.source === 'greenhouse' && offer.ats_token) return `https://job-boards.greenhouse.io/${offer.ats_token}/jobs/${offer.external_id}`
  return null
}

export function screenshotPath(candidateId: string, opportunityId: string, moment: 'filled' | 'sent'): string {
  return path.join(DATA_DIRECTORY, 'applications', candidateId, `${opportunityId}-${moment}.png`)
}

// Where each answer's field sits among the marked ones.
const indexOfField = new WeakMap<PreparedAnswer, number>()
const fieldIndex = (answer: PreparedAnswer) => indexOfField.get(answer) ?? -1

const YES = /^(yes|si|sí|true)$/i
const NO = /^(no|false)$/i

// The value each field gets, from what is known; null when nothing is.
function valueFor(answer: PreparedAnswer, saved: Record<string, string>): string | null {
  if (answer.source === 'fact' || answer.source === 'rep') return answer.answer
  return saved[questionKey(answer.label)] ?? null
}

// Marks each field's container on the page, found by its label, so it can be
// acted on. A container is the nearest block around the label that holds a
// control of its own.
// Sent to the page as text: a bundler's helpers must not travel with it.
const MARK_FIELDS = String.raw`(wanted) => {
  const clean = (text) => (text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const controls = 'input:not([type=hidden]),textarea,select,button,[role=combobox],[role=radio],[role=checkbox]'
  const candidates = Array.from(document.querySelectorAll('label, legend, p, span, div, h3, h4'))
  return wanted.map((label, index) => {
    const target = clean(label)
    const labelEl = candidates.find((el) => clean(el.textContent) === target && el.children.length <= 3)
    if (!labelEl) return false
    let container = labelEl
    for (let depth = 0; container && depth < 6; depth++) {
      if (container.querySelector(controls)) break
      container = container.parentElement
    }
    if (!container || !container.querySelector(controls)) return false
    container.setAttribute('data-amble-field', String(index))
    return true
  })
}`

async function markFields(page: Page, labels: string[]): Promise<boolean[]> {
  return page.evaluate(`(${MARK_FIELDS})(${JSON.stringify(labels)})`) as Promise<boolean[]>
}

async function fillField(page: Page, index: number, answer: PreparedAnswer, value: string | null, files: { cv: string | null; cvName: string | null; letter: Buffer | null }): Promise<boolean> {
  const field = page.locator(`[data-amble-field="${index}"]`)
  if (answer.kind === 'resume' || answer.kind === 'cover_letter' || answer.kind === 'file') {
    if (DRY) return false
    const input = field.locator('input[type=file]').first()
    if ((await input.count()) === 0) return false
    if (answer.kind === 'resume' && files.cv) {
      await input.setInputFiles({ name: files.cvName ?? 'CV.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(files.cv) })
      return true
    }
    if (answer.kind === 'cover_letter' && files.letter) {
      await input.setInputFiles({ name: 'Cover letter.pdf', mimeType: 'application/pdf', buffer: files.letter })
      return true
    }
    return false
  }
  if (value === null) return false

  if (answer.kind === 'yes_no') {
    const wanted = YES.test(value) ? /^(yes|sí|si)$/i : NO.test(value) ? /^no$/i : null
    if (!wanted) return false
    const button = field.getByRole('button', { name: wanted }).first()
    if ((await button.count()) > 0) {
      await button.click()
      return true
    }
    const radio = field.getByRole('radio', { name: wanted }).first()
    if ((await radio.count()) > 0) {
      await radio.check()
      return true
    }
    return false
  }

  if (answer.kind === 'choice') {
    const select = field.locator('select').first()
    if ((await select.count()) > 0) {
      await select.selectOption({ label: value })
      return true
    }
    const option = field.getByRole('radio', { name: value }).or(field.getByRole('checkbox', { name: value })).first()
    if ((await option.count()) > 0) {
      await option.check()
      return true
    }
    const combo = field.locator('[role=combobox], input').first()
    if ((await combo.count()) > 0) {
      await combo.fill(value)
      await page.keyboard.press('Enter')
      return true
    }
    return false
  }

  const text = field.locator('textarea, input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])').first()
  if ((await text.count()) === 0) return false
  await text.fill(value)
  // A search box with suggestions ("Start typing…" for a location): the value
  // counts only once one of its suggestions is chosen.
  const suggests = (await text.getAttribute('role')) === 'combobox' || (await text.getAttribute('aria-autocomplete')) !== null
  if (suggests) {
    const option = page.getByRole('option').first()
    await option.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
    if ((await option.count()) > 0) await option.click()
    else await page.keyboard.press('Enter')
  }
  return true
}

// The message as a one-page letter, for forms that take it as a file.
async function letterPdf(browser: Browser, message: string): Promise<Buffer | null> {
  if (HEADED) return null
  const page = await browser.newPage()
  try {
    const escaped = message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
    await page.setContent(
      `<html><body style="font-family: Georgia, serif; font-size: 12pt; line-height: 1.55; margin: 64px 72px; white-space: pre-line">${escaped}</body></html>`,
    )
    return await page.pdf({ format: 'A4' })
  } finally {
    await page.close()
  }
}

export async function fillApplication(candidateId: string, opportunityId: string): Promise<FillResult> {
  const prepared = getPreparedApplication(candidateId, opportunityId)
  if (!prepared) return { status: 'unavailable', reason: 'not_prepared' }
  const offer = getDb()
    .prepare(
      `SELECT s.source, s.external_id, s.url, c.ats_token, o.title FROM opportunity_sources s
       JOIN opportunities o ON o.id = s.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE s.opportunity_id = ? AND s.closed_at IS NULL ORDER BY s.last_seen_at DESC LIMIT 1`,
    )
    .get(opportunityId) as OfferRow | undefined
  const url = offer ? applyUrl(offer) : null
  if (!url) return { status: 'unavailable', reason: 'unknown_form' }
  if (!fs.existsSync(CHROME)) return { status: 'unavailable', reason: 'no_browser' }

  const saved = savedAnswers(candidateId)
  const cv = applicationCv(candidateId)
  // Nothing is filled while a required field has nothing to go in it.
  const missing = prepared.answers
    .filter((answer) => answer.required)
    .filter((answer) => (answer.kind === 'resume' ? !cv : answer.kind === 'cover_letter' ? !prepared.message : valueFor(answer, saved) === null))
    .map((answer) => answer.label)
  // In a window they finish it themselves; out of sight nothing may be missing.
  if (missing.length > 0 && !DRY && !HEADED) return { status: 'missing', missing }

  const key = sessionKey(candidateId, opportunityId)
  await closeSession(key)
  // Loaded only when a form is filled: where there is no browser, never.
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED })
  try {
    const page = await browser.newPage({ viewport: HEADED ? null : { width: 1180, height: 900 }, locale: 'en-US' })
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATION_MS })
    const letter = prepared.message && prepared.answers.some((answer) => answer.kind === 'cover_letter') ? await letterPdf(browser, prepared.message) : null

    const found = await markFields(page, prepared.answers.map((answer) => answer.label))
    prepared.answers.forEach((answer, index) => indexOfField.set(answer, index))
    const filled: string[] = []
    const left: string[] = []
    for (const [index, answer] of prepared.answers.entries()) {
      const done =
        found[index] &&
        (await fillField(page, index, answer, valueFor(answer, saved), { cv: cv?.path ?? null, cvName: cv?.filename ?? null, letter }).catch(() => false))
      ;(done ? filled : left).push(answer.label)
    }
    // Uploads settle before the picture is taken.
    await page.waitForTimeout(1500)
    const shot = screenshotPath(candidateId, opportunityId, 'filled')
    fs.mkdirSync(path.dirname(shot), { recursive: true })
    await page.screenshot({ path: shot, fullPage: true })
    const captcha = (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .grecaptcha-badge').count()) > 0
    const session: Session = { browser, page, expires: Date.now() + SESSION_MINUTES * 60_000, state: 'open' }
    sessions.set(key, session)
    if (HEADED) watchWindow(candidateId, opportunityId, session, prepared.answers.filter((answer) => left.includes(answer.label)))
    return { status: 'filled', filled, left, captcha, window: HEADED }
  } catch (error) {
    await browser.close().catch(() => undefined)
    throw error
  }
}

// While they finish the form in the window: what they type in the fields left
// to them is kept for the next form, and when the page says it was sent the
// offer is marked as sent. Closing the window without sending ends it.
function watchWindow(candidateId: string, opportunityId: string, session: Session, left: PreparedAnswer[]) {
  const { page } = session
  const timer = setInterval(async () => {
    if (page.isClosed()) {
      clearInterval(timer)
      if (session.state === 'open') session.state = 'closed'
      await session.browser.close().catch(() => undefined)
      return
    }
    try {
      const text = await page.evaluate(() => document.body.innerText)
      if (SENT.test(text)) {
        clearInterval(timer)
        session.state = 'sent'
        setProgress(candidateId, [opportunityId], 'applied')
        setTimeout(() => void session.browser.close().catch(() => undefined), 4000)
        return
      }
      // What they typed where amble left the field to them.
      const values = (await page.evaluate(
        `Array.from(document.querySelectorAll('[data-amble-field]')).map((el) => [el.getAttribute('data-amble-field'), (el.querySelector('textarea, input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])') || {}).value || ''])`,
      )) as [string, string][]
      const byIndex = new Map(values)
      for (const answer of left) {
        if (answer.kind === 'resume' || answer.kind === 'file' || answer.kind === 'cover_letter') continue
        const value = byIndex.get(String(fieldIndex(answer)))
        if (value && value.trim()) saveAnswer(candidateId, answer.label, value)
      }
    } catch {
      // The page is between two states (sending, navigating): look again next time.
    }
  }, 1500)
}

export function applicationState(candidateId: string, opportunityId: string): 'open' | 'sent' | 'closed' | 'none' {
  return sessions.get(sessionKey(candidateId, opportunityId))?.state ?? 'none'
}

export type SubmitResult = { status: 'sent' } | { status: 'expired' } | { status: 'blocked'; reason: 'captcha' | 'rejected' | 'unclear' }

const SENT = /(thank you|thanks for applying|application (has been )?(submitted|received)|we('|’)ve received your application|successfully (submitted|applied))/i

export async function submitApplication(candidateId: string, opportunityId: string): Promise<SubmitResult> {
  const key = sessionKey(candidateId, opportunityId)
  if (DRY) {
    await closeSession(key)
    return { status: 'blocked', reason: 'unclear' }
  }
  const session = sessions.get(key)
  if (!session || session.expires < Date.now()) {
    await closeSession(key)
    return { status: 'expired' }
  }
  const { page } = session
  try {
    const submit = page.getByRole('button', { name: /submit( application)?|send application|apply/i }).last()
    if ((await submit.count()) === 0) return { status: 'blocked', reason: 'unclear' }
    await submit.click()
    const outcome = await Promise.race([
      page.waitForFunction((pattern) => new RegExp(pattern, 'i').test(document.body.innerText), SENT.source, { timeout: SUBMIT_WAIT_MS }).then(() => 'sent' as const),
      page
        .locator('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha"]')
        .first()
        .waitFor({ state: 'visible', timeout: SUBMIT_WAIT_MS })
        .then(() => 'captcha' as const),
    ]).catch(() => 'unclear' as const)
    const shot = screenshotPath(candidateId, opportunityId, 'sent')
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined)
    if (outcome === 'sent') return { status: 'sent' }
    // Still on the form with errors showing: the company's form said no.
    const errors = await page.locator('[role=alert], [class*=error i]').count()
    return { status: 'blocked', reason: outcome === 'captcha' ? 'captcha' : errors > 0 ? 'rejected' : 'unclear' }
  } finally {
    await closeSession(key)
  }
}

export async function cancelApplication(candidateId: string, opportunityId: string): Promise<void> {
  await closeSession(sessionKey(candidateId, opportunityId))
}
