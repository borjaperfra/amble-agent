import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { CHROME } from './chrome'
import { DATA_DIRECTORY, getDb } from '../db/db'
import { setProgress } from '../db/matching'
import { applicationCv, questionKey, saveAnswer, savedAnswers } from './answers'
import { getPreparedApplication, type PreparedAnswer } from './prepare'
import { cloudBrowserConfigured, createCloudSession, liveViewOf, releaseCloudSession } from './cloud'
import { applyStrategy, holds, learn, MAX_TRIES, optionFor, strategiesFor, type Files } from './reflect'

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
const ACTION_MS = 8_000

interface Session {
  browser: Browser
  page: Page
  expires: number
  // A window the candidate finishes: whether they sent it or closed it.
  state: 'open' | 'sent' | 'closed'
  // In the cloud: the session to end, and its live view (never sent anywhere).
  cloudId: string | null
  liveUrl: string | null
  // The form already said "thank you" before anything was sent (a form that
  // thanks you for your interest): then only the form gone means it was.
  thanksBefore: boolean
  // amble is pressing send on their yes: what follows is told by whoever
  // asked, not by the window's watcher.
  amble: boolean
  // Where they asked for it: kept with the record of the send.
  via: 'app' | 'whatsapp'
}

declare global {
  var __ambleApplySessions: Map<string, Session> | undefined
  var __ambleApplyFilling: Map<string, Promise<FillResult>> | undefined
  var __ambleApplySubmitting: Map<string, Promise<SubmitResult>> | undefined
}

const sessions = (globalThis.__ambleApplySessions ??= new Map<string, Session>())
// Fills under way: a second ask for the same form (a double tap) waits for
// the first instead of opening a second browser.
const filling = (globalThis.__ambleApplyFilling ??= new Map<string, Promise<FillResult>>())
// Sends under way: a second yes (a double click) never presses the button twice.
const submitting = (globalThis.__ambleApplySubmitting ??= new Map<string, Promise<SubmitResult>>())
const sessionKey = (candidateId: string, opportunityId: string) => `${candidateId}:${opportunityId}`
// Forms one person can have open at once: each is a browser, in the cloud a paid one.
const MAX_OPEN_FORMS = 2

async function closeSession(key: string) {
  const session = sessions.get(key)
  sessions.delete(key)
  await session?.browser.close().catch(() => undefined)
  if (session?.cloudId) await releaseCloudSession(session.cloudId)
}

// The browser for one form: a Chrome of our own, or one in the cloud.
async function openBrowser(candidateId: string): Promise<{ browser: Browser; cloudId: string | null; liveUrl: string | null; minutes: number }> {
  // Loaded only when a form is filled: where there is no browser, never.
  const { chromium } = await import('playwright-core')
  if (!CLOUD) return { browser: await chromium.launch({ executablePath: CHROME, headless: !HEADED }), cloudId: null, liveUrl: null, minutes: SESSION_MINUTES }
  const cloud = await createCloudSession(SESSION_MINUTES, candidateId)
  try {
    const browser = await chromium.connectOverCDP(cloud.connectUrl, { timeout: NAVIGATION_MS })
    return { browser, cloudId: cloud.id, liveUrl: await liveViewOf(cloud.id), minutes: cloud.minutes }
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
  // The board's own form, embeddable: the job page of a company with its own
  // careers site sends the browser there, where the form sits in a frame, or
  // is theirs.
  if (offer.source === 'greenhouse' && offer.ats_token)
    return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(offer.ats_token)}&token=${encodeURIComponent(offer.external_id)}`
  return null
}

export function screenshotPath(candidateId: string, opportunityId: string, moment: 'filled' | 'sent'): string {
  return path.join(DATA_DIRECTORY, 'applications', candidateId, `${opportunityId}-${moment}.png`)
}

// The filled form as a picture light enough for WhatsApp, for an ask made there.
function picturePath(candidateId: string, opportunityId: string): string {
  return path.join(DATA_DIRECTORY, 'applications', candidateId, `${opportunityId}-filled.jpg`)
}

export function filledPicture(candidateId: string, opportunityId: string): Buffer | null {
  try {
    return fs.readFileSync(picturePath(candidateId, opportunityId))
  } catch {
    return null
  }
}

// Where each answer's field sits among the marked ones.
const indexOfField = new WeakMap<PreparedAnswer, number>()
const fieldIndex = (answer: PreparedAnswer) => indexOfField.get(answer) ?? -1

// The value each field gets, from what is known; null when nothing is. For a
// question with options, the option that says what they answered.
function valueFor(answer: PreparedAnswer, saved: Record<string, string>): string | null {
  const value = answer.source === 'fact' || answer.source === 'rep' ? answer.answer : (saved[questionKey(answer.label)] ?? null)
  return value !== null && answer.kind === 'choice' && answer.options.length > 0 ? optionFor(value, answer.options) : value
}

// Marks each field's container on the page, and its control when it has one
// of its own, so it can be acted on. Found by the id the ATS gives it (Ashby
// marks the field's block with its path; Greenhouse names the control after
// the field), else by its label: the nearest block around the label that
// holds a control.
// Sent to the page as text: a bundler's helpers must not travel with it.
const MARK_FIELDS = String.raw`(wanted) => {
  const clean = (text) => (text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const controls = 'input:not([type=hidden]),textarea,select,button,[role=combobox],[role=radio],[role=checkbox]'
  // A label's own words, without the options of a list it wraps.
  const ownText = (el) => {
    const copy = el.cloneNode(true)
    copy.querySelectorAll('select, option, textarea, input, [role=listbox]').forEach((child) => child.remove())
    return clean(copy.textContent)
  }
  const byId = (id) => {
    if (!id) return null
    const block = document.querySelector('[data-field-path="' + CSS.escape(id) + '"]')
    if (block) return { container: block, control: null }
    const plain = id.replace(/\[\]$/, '')
    const control = document.getElementById(id) || document.getElementById(plain) || document.querySelector('[name="' + CSS.escape(id) + '"]')
    if (!control) return null
    // A group (a fieldset of checkboxes) is the field's block itself.
    const isControl = control.matches('input, textarea, select, [role=combobox]')
    if (!isControl) return control.querySelector(controls) ? { container: control, control: null } : null
    // Up to the block that also holds its label.
    let container = control.parentElement
    for (let depth = 0; container && depth < 8; depth++) {
      if (container.querySelector('label, legend')) break
      container = container.parentElement
    }
    return container ? { container, control } : null
  }
  const candidates = Array.from(document.querySelectorAll('label, legend, p, span, div, h3, h4'))
  const byLabel = (label) => {
    const target = clean(label)
    if (!target) return null
    // The label as written, else one that starts with it (a board may add a hint after it).
    const labelEl =
      candidates.find((el) => clean(el.textContent) === target && el.children.length <= 3) ||
      candidates.find((el) => (el.tagName === 'LABEL' || el.tagName === 'LEGEND') && ownText(el) === target) ||
      candidates.find((el) => (el.tagName === 'LABEL' || el.tagName === 'LEGEND') && target.length >= 4 && ownText(el).startsWith(target))
    if (!labelEl) return null
    let container = labelEl
    for (let depth = 0; container && depth < 6; depth++) {
      if (container.querySelector(controls)) break
      container = container.parentElement
    }
    if (!container || !container.querySelector(controls)) return null
    const forId = labelEl.getAttribute('for')
    const control = forId ? document.getElementById(forId) : null
    return { container, control: control && container.contains(control) ? control : null }
  }
  return wanted.map(([label, id], index) => {
    const found = byId(id) || byLabel(label)
    if (!found || found.container.hasAttribute('data-amble-field')) return false
    found.container.setAttribute('data-amble-field', String(index))
    if (found.control) found.control.setAttribute('data-amble-control', String(index))
    return true
  })
}`

async function markFields(page: Page, fields: [string, string][]): Promise<boolean[]> {
  return page.evaluate(`(${MARK_FIELDS})(${JSON.stringify(fields)})`) as Promise<boolean[]>
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

function openFormsOf(candidateId: string, except: string): number {
  const prefix = `${candidateId}:`
  const open = [...sessions].filter(([key, session]) => key.startsWith(prefix) && key !== except && session.state === 'open' && session.expires > Date.now()).length
  const starting = [...filling.keys()].filter((key) => key.startsWith(prefix) && key !== except).length
  return open + starting
}

// Each fill and each send, how it ended, for the admin's health tab. Its
// record never changes what the candidate is told: a failed write is dropped,
// and the result (or the error) goes back as it came.
function recorded<T>(
  run: { candidateId: string; opportunityId: string; kind: 'fill' | 'submit'; via: 'app' | 'whatsapp' },
  work: () => Promise<T>,
  outcomeOf: (result: T) => { outcome: string; detail: string | null },
): Promise<T> {
  const startedAt = new Date().toISOString()
  const write = (outcome: string, detail: string | null) => {
    try {
      getDb()
        .prepare('INSERT INTO application_runs (candidate_id, opportunity_id, kind, via, outcome, detail, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(run.candidateId, run.opportunityId, run.kind, run.via, outcome, detail?.slice(0, 500) ?? null, startedAt, new Date().toISOString())
    } catch {
      // Only the record is missing.
    }
  }
  return work().then(
    (result) => {
      const { outcome, detail } = outcomeOf(result)
      write(outcome, detail)
      return result
    },
    (error: unknown) => {
      write('error', error instanceof Error ? error.message : String(error))
      throw error
    },
  )
}

function fillOutcome(result: FillResult): { outcome: string; detail: string | null } {
  if (result.status === 'filled') return { outcome: result.captcha ? 'filled_captcha' : 'filled', detail: `${result.filled.length} filled, ${result.left.length} left` }
  if (result.status === 'missing') return { outcome: 'missing', detail: `${result.missing.length} missing` }
  return { outcome: 'unavailable', detail: result.reason }
}

function submitOutcome(result: SubmitResult): { outcome: string; detail: string | null } {
  return result.status === 'blocked' ? { outcome: 'blocked', detail: result.reason } : { outcome: result.status, detail: null }
}

// `via`: where they asked for it. Asked on WhatsApp, they are told there
// when the page says it was sent.
export function fillApplication(candidateId: string, opportunityId: string, via: 'app' | 'whatsapp' = 'app'): Promise<FillResult> {
  const key = sessionKey(candidateId, opportunityId)
  const running = filling.get(key)
  if (running) return running
  if (openFormsOf(candidateId, key) >= MAX_OPEN_FORMS) return Promise.resolve({ status: 'unavailable', reason: 'too_many_open' })
  const job = recorded({ candidateId, opportunityId, kind: 'fill', via }, () => fill(candidateId, opportunityId, via), fillOutcome).finally(() => filling.delete(key))
  filling.set(key, job)
  return job
}

async function fill(candidateId: string, opportunityId: string, via: 'app' | 'whatsapp'): Promise<FillResult> {
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
  const { browser, cloudId, liveUrl, minutes } = await openBrowser(candidateId)
  try {
    const context = CLOUD ? (browser.contexts()[0] ?? (await browser.newContext())) : null
    const page = context ? (context.pages()[0] ?? (await context.newPage())) : await browser.newPage({ viewport: HEADED ? null : { width: 1180, height: 900 }, locale: 'en-US' })
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATION_MS })
    const letter = prepared.message && prepared.answers.some((answer) => answer.kind === 'cover_letter') ? await letterPdf(browser, prepared.message).catch(() => null) : null

    // A control that does not answer is given up on quickly, not after half a minute.
    page.setDefaultTimeout(ACTION_MS)
    const wanted = prepared.answers.map((answer): [string, string] => [answer.label, answer.fieldId])
    let found = await markFields(page, wanted)
    // No form on the page: a board that turns visitors away for a moment
    // ("unavailable at this time, try again later") is asked once more; an
    // offer that closed, or a form still missing, is not filled at all.
    if (wanted.length > 0 && !found.some(Boolean)) {
      await page.waitForTimeout(4000)
      await page.reload({ waitUntil: 'networkidle', timeout: NAVIGATION_MS })
      found = await markFields(page, wanted)
      if (!found.some(Boolean)) {
        await browser.close().catch(() => undefined)
        if (cloudId) await releaseCloudSession(cloudId)
        return { status: 'unavailable', reason: 'form_not_found' }
      }
    }
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
      // A way that does not apply to this control is not a try.
      let attempts = 0
      for (const strategy of strategiesFor(ats, answer)) {
        if (attempts >= MAX_TRIES) break
        const applied = await applyStrategy(page, index, answer, value, files, strategy).catch(() => false)
        if (!applied) continue
        // Uploads and suggestion boxes settle before the field is read back.
        await page.waitForTimeout(answer.kind === 'resume' || answer.kind === 'cover_letter' ? 1500 : 250)
        held = await holds(page, index, answer, value, files)
        learn(ats, answer, strategy, held)
        if (attempts > 0) retried++
        attempts++
        if (held) break
      }
      ;(held ? filled : left).push(answer.label)
    }
    const shot = screenshotPath(candidateId, opportunityId, 'filled')
    fs.mkdirSync(path.dirname(shot), { recursive: true })
    await page.screenshot({ path: shot, fullPage: true })
    if (via === 'whatsapp') await page.screenshot({ path: picturePath(candidateId, opportunityId), type: 'jpeg', quality: 70, fullPage: true }).catch(() => undefined)
    const captcha = (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .grecaptcha-badge').count()) > 0
    const thanksBefore = SENT.test(await page.evaluate(() => document.body.innerText).catch(() => ''))
    const session: Session = { browser, page, expires: Date.now() + minutes * 60_000, state: 'open', cloudId, liveUrl, thanksBefore, amble: false, via }
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
    // amble is sending it: the one who asked says how it went.
    if (session.amble) return
    try {
      if (await readsAsSent(page, session.thanksBefore)) {
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
        `Array.from(document.querySelectorAll('[data-amble-field]')).map((el) => [el.getAttribute('data-amble-field'), (el.querySelector('[data-amble-control]:not([type=file])') || el.querySelector('textarea, input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])') || {}).value || ''])`,
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

// Whether the page says the application went: its words, and, when the form
// said them from the start, the form no longer there.
const READS_AS_SENT = String.raw`([pattern, thanksBefore]) => {
  if (!new RegExp(pattern, 'i').test(document.body.innerText)) return false
  if (!thanksBefore) return true
  // The form gone: none of the fields amble marked, and hardly a control left.
  const controls = document.querySelectorAll('input:not([type=hidden]):not([type=search]), textarea, select').length
  return document.querySelectorAll('[data-amble-field]').length === 0 && controls < 2
}`

export async function readsAsSent(page: Page, thanksBefore: boolean): Promise<boolean> {
  return Boolean(await page.evaluate(`(${READS_AS_SENT})(${JSON.stringify([SENT.source, thanksBefore])})`))
}

export function submitApplication(candidateId: string, opportunityId: string): Promise<SubmitResult> {
  const key = sessionKey(candidateId, opportunityId)
  const running = submitting.get(key)
  if (running) return running
  const via = sessions.get(key)?.via ?? 'app'
  const job = recorded({ candidateId, opportunityId, kind: 'submit', via }, () => submit(candidateId, opportunityId, key), submitOutcome).finally(() =>
    submitting.delete(key),
  )
  submitting.set(key, job)
  return job
}

async function submit(candidateId: string, opportunityId: string, key: string): Promise<SubmitResult> {
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
  session.amble = true
  // Left open when it did not go and they can finish it in the live view;
  // closed once it went, or when there is no window to finish it in.
  let sent = false
  try {
    const submit = page.getByRole('button', { name: /submit( application)?|send application|apply/i }).last()
    if ((await submit.count()) === 0) return { status: 'blocked', reason: 'unclear' }
    await submit.click()
    const outcome = await Promise.race([
      page.waitForFunction(`(${READS_AS_SENT})(${JSON.stringify([SENT.source, session.thanksBefore])})`, undefined, { timeout: SUBMIT_WAIT_MS }).then(() => 'sent' as const),
      page
        .locator('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha"]')
        .first()
        .waitFor({ state: 'visible', timeout: SUBMIT_WAIT_MS })
        .then(() => 'captcha' as const),
    ]).catch(() => 'unclear' as const)
    const shot = screenshotPath(candidateId, opportunityId, 'sent')
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined)
    if (outcome === 'sent') {
      sent = true
      return { status: 'sent' }
    }
    // Still on the form with errors showing: the company's form said no.
    const errors = await page.locator('[role=alert], [class*=error i]').count()
    return { status: 'blocked', reason: outcome === 'captcha' ? 'captcha' : errors > 0 ? 'rejected' : 'unclear' }
  } finally {
    if (!sent && session.liveUrl) session.amble = false
    else await closeSession(key)
  }
}

export async function cancelApplication(candidateId: string, opportunityId: string): Promise<void> {
  await closeSession(sessionKey(candidateId, opportunityId))
}

// Every form a person has open, closed: their account is going.
export async function closeApplicationsOf(candidateId: string): Promise<void> {
  const prefix = `${candidateId}:`
  await Promise.allSettled([...filling].filter(([key]) => key.startsWith(prefix)).map(([, job]) => job))
  await Promise.all([...sessions.keys()].filter((key) => key.startsWith(prefix)).map((key) => closeSession(key)))
}
