import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { CHROME } from './chrome'
import { DATA_DIRECTORY, getDb } from '../db/db'
import { setProgress } from '../db/matching'
import { applicationCv, questionKey, saveAnswer, savedAnswers } from './answers'
import { getPreparedApplication, type PreparedAnswer } from './prepare'
import { cloudBrowserConfigured, createCloudSession, liveViewOf, releaseCloudSession } from './cloud'
import { applyStrategy, holds, learn, MAX_TRIES, strategiesFor, type Files } from './reflect'

// Filling an application form from a browser amble opens, and sending it only
// when the candidate says so. The page stays open between the two, for a
// while: what is sent is exactly what they saw.
//
// It fills what it knows (facts, what the Rep wrote, what they answered) and
// leaves the rest; it never guesses a field it cannot place.

// Where the candidate is at their computer (development, for now), the form
// opens in a window they see: amble fills what it knows and they finish it
// and send it there. On a server with a cloud browser, the same happens in
// its live view, shown in amble's page. On a server without one, it is
// filled out of sight and they approve a picture of it.
const CLOUD = cloudBrowserConfigured()
const HEADED = !CLOUD && (process.env.AMBLE_BROWSER_HEADED === '1' || (process.env.NODE_ENV !== 'production' && process.env.AMBLE_BROWSER_HEADED !== '0'))
// A window they finish themselves: on their screen, or in the live view.
const WINDOW = HEADED || CLOUD
// A rehearsal, for development: fills what it can but attaches no file (a
// form may upload one the moment it is attached) and does not wait for every
// required answer. Sending is refused.
const DRY = process.env.AMBLE_FILL_DRY === '1'
// A window they finish by hand gets longer than a form waiting for a yes.
const SESSION_MINUTES = WINDOW ? 45 : 20
const NAVIGATION_MS = 45_000
const SUBMIT_WAIT_MS = 25_000

interface Session {
  browser: Browser
  page: Page
  expires: number
  // A window the candidate finishes: whether they sent it or closed it.
  state: 'open' | 'sent' | 'closed'
  // In the cloud: the session to end, and its live view (never sent anywhere).
  cloudId: string | null
  liveUrl: string | null
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
  if (session?.cloudId) await releaseCloudSession(session.cloudId)
}

// The browser for one form: a Chrome of our own, or one in the cloud.
async function openBrowser(candidateId: string): Promise<{ browser: Browser; cloudId: string | null; liveUrl: string | null }> {
  // Loaded only when a form is filled: where there is no browser, never.
  const { chromium } = await import('playwright-core')
  if (!CLOUD) return { browser: await chromium.launch({ executablePath: CHROME, headless: !HEADED }), cloudId: null, liveUrl: null }
  const cloud = await createCloudSession(SESSION_MINUTES, candidateId)
  try {
    const browser = await chromium.connectOverCDP(cloud.connectUrl, { timeout: NAVIGATION_MS })
    return { browser, cloudId: cloud.id, liveUrl: await liveViewOf(cloud.id) }
  } catch (error) {
    await releaseCloudSession(cloud.id)
    throw error
  }
}

// Forms left open are closed after a while, whatever happened to them.
setInterval(() => {
  for (const [key, session] of sessions) if (session.expires < Date.now()) void closeSession(key)
}, 60_000).unref?.()

export type FillResult =
  | { status: 'filled'; filled: string[]; left: string[]; captcha: boolean; window: boolean; live: boolean; retried: number }
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

function offerOf(opportunityId: string): OfferRow | undefined {
  return getDb()
    .prepare(
      `SELECT s.source, s.external_id, s.url, c.ats_token, o.title FROM opportunity_sources s
       JOIN opportunities o ON o.id = s.opportunity_id JOIN companies c ON c.id = o.company_id
       WHERE s.opportunity_id = ? AND s.closed_at IS NULL ORDER BY s.last_seen_at DESC LIMIT 1`,
    )
    .get(opportunityId) as OfferRow | undefined
}

// Whether amble knows how to reach this offer's form.
export function canFillForm(opportunityId: string): boolean {
  const offer = offerOf(opportunityId)
  return Boolean(offer && applyUrl(offer))
}

// `via`: where they asked for it. Asked on WhatsApp, they are told there
// when the page says it was sent.
export async function fillApplication(candidateId: string, opportunityId: string, via: 'app' | 'whatsapp' = 'app'): Promise<FillResult> {
  const prepared = getPreparedApplication(candidateId, opportunityId)
  if (!prepared) return { status: 'unavailable', reason: 'not_prepared' }
  const offer = offerOf(opportunityId)
  const url = offer ? applyUrl(offer) : null
  if (!url) return { status: 'unavailable', reason: 'unknown_form' }
  if (!CLOUD && !fs.existsSync(CHROME)) return { status: 'unavailable', reason: 'no_browser' }

  const saved = savedAnswers(candidateId)
  const cv = applicationCv(candidateId)
  // Nothing is filled while a required field has nothing to go in it.
  const missing = prepared.answers
    .filter((answer) => answer.required)
    .filter((answer) => (answer.kind === 'resume' ? !cv : answer.kind === 'cover_letter' ? !prepared.message : valueFor(answer, saved) === null))
    .map((answer) => answer.label)
  // In a window they finish it themselves; out of sight nothing may be missing.
  if (missing.length > 0 && !DRY && !WINDOW) return { status: 'missing', missing }

  const key = sessionKey(candidateId, opportunityId)
  await closeSession(key)
  const { browser, cloudId, liveUrl } = await openBrowser(candidateId)
  try {
    const context = CLOUD ? (browser.contexts()[0] ?? (await browser.newContext())) : null
    const page = context ? (context.pages()[0] ?? (await context.newPage())) : await browser.newPage({ viewport: HEADED ? null : { width: 1180, height: 900 }, locale: 'en-US' })
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATION_MS })
    const letter = prepared.message && prepared.answers.some((answer) => answer.kind === 'cover_letter') ? await letterPdf(browser, prepared.message).catch(() => null) : null

    const found = await markFields(page, prepared.answers.map((answer) => answer.label))
    prepared.answers.forEach((answer, index) => indexOfField.set(answer, index))
    const files: Files = { cv: cv?.path ?? null, cvName: cv?.filename ?? null, letter }
    const ats = offer?.source ?? 'unknown'
    const filled: string[] = []
    const left: string[] = []
    let retried = 0
    for (const [index, answer] of prepared.answers.entries()) {
      if (!found[index] || (DRY && (answer.kind === 'resume' || answer.kind === 'cover_letter' || answer.kind === 'file'))) {
        left.push(answer.label)
        continue
      }
      const value = valueFor(answer, saved)
      // Try, look again, and try another way while it did not take.
      let held = false
      for (const [attempt, strategy] of strategiesFor(ats, answer).slice(0, MAX_TRIES).entries()) {
        const applied = await applyStrategy(page, index, answer, value, files, strategy).catch(() => false)
        if (!applied) continue
        // Uploads and suggestion boxes settle before the field is read back.
        await page.waitForTimeout(answer.kind === 'resume' || answer.kind === 'cover_letter' ? 1500 : 250)
        held = await holds(page, index, answer, value, files)
        learn(ats, answer, strategy, held)
        if (attempt > 0) retried++
        if (held) break
      }
      ;(held ? filled : left).push(answer.label)
    }
    const shot = screenshotPath(candidateId, opportunityId, 'filled')
    fs.mkdirSync(path.dirname(shot), { recursive: true })
    await page.screenshot({ path: shot, fullPage: true })
    const captcha = (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .grecaptcha-badge').count()) > 0
    const session: Session = { browser, page, expires: Date.now() + SESSION_MINUTES * 60_000, state: 'open', cloudId, liveUrl }
    sessions.set(key, session)
    if (WINDOW) watchWindow(candidateId, opportunityId, session, prepared.answers.filter((answer) => left.includes(answer.label)), via)
    return { status: 'filled', filled, left, captcha, window: WINDOW, live: Boolean(liveUrl), retried }
  } catch (error) {
    await browser.close().catch(() => undefined)
    if (cloudId) await releaseCloudSession(cloudId)
    throw error
  }
}

// The live view of a form open in the cloud, for the signed-in candidate's page.
export function liveViewFor(candidateId: string, opportunityId: string): string | null {
  const session = sessions.get(sessionKey(candidateId, opportunityId))
  return session && session.state === 'open' && session.expires > Date.now() ? session.liveUrl : null
}

// While they finish the form in the window: what they type in the fields left
// to them is kept for the next form, and when the page says it was sent the
// offer is marked as sent. Closing the window without sending ends it.
function watchWindow(candidateId: string, opportunityId: string, session: Session, left: PreparedAnswer[], via: 'app' | 'whatsapp') {
  const { page } = session
  const timer = setInterval(async () => {
    if (page.isClosed()) {
      clearInterval(timer)
      if (session.state === 'open') session.state = 'closed'
      await session.browser.close().catch(() => undefined)
      if (session.cloudId) await releaseCloudSession(session.cloudId)
      return
    }
    try {
      const text = await page.evaluate(() => document.body.innerText)
      if (SENT.test(text)) {
        clearInterval(timer)
        session.state = 'sent'
        setProgress(candidateId, [opportunityId], 'applied')
        if (via === 'whatsapp') void import('../whatsapp/sent').then((module) => module.tellSent(candidateId, opportunityId)).catch(() => undefined)
        setTimeout(() => {
          void session.browser.close().catch(() => undefined)
          if (session.cloudId) void releaseCloudSession(session.cloudId)
        }, 4000)
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
