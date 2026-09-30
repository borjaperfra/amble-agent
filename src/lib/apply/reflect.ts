import fs from 'node:fs'
import type { Page } from 'playwright-core'
import { getDb } from '../db/db'
import { now } from '../db/repo'
import type { PreparedAnswer } from './prepare'

// Filling a form the way a careful person does: fill a field, look at it
// again, and if it did not take (a suggestion box that wants an option
// chosen, a control that ignores a pasted value, an upload that did not
// attach), try another way, up to a few times, before leaving it to them.
// What held and what did not is kept per ATS and kind of field, so the next
// form, anyone's, starts with the way that works there.

export type Strategy = 'fill' | 'type' | 'fill_tab' | 'suggest_first' | 'suggest_match' | 'select' | 'option_click' | 'button' | 'radio' | 'label' | 'upload'

type Group = 'text' | 'choice' | 'yes_no' | 'file'

const STRATEGIES: Record<Group, Strategy[]> = {
  text: ['fill', 'suggest_match', 'type', 'fill_tab'],
  choice: ['select', 'option_click', 'suggest_match', 'label'],
  yes_no: ['button', 'radio', 'label'],
  file: ['upload'],
}

// Rounds of trying, the first included.
export const MAX_TRIES = 3

function groupOf(answer: PreparedAnswer): Group {
  if (answer.kind === 'resume' || answer.kind === 'cover_letter' || answer.kind === 'file') return 'file'
  if (answer.kind === 'yes_no') return 'yes_no'
  if (answer.kind === 'choice') return 'choice'
  return 'text'
}

// The ways to try a field, the ones that held most often on this ATS first.
export function strategiesFor(ats: string, answer: PreparedAnswer): Strategy[] {
  const group = groupOf(answer)
  const rows = getDb().prepare('SELECT strategy, worked, failed FROM form_lessons WHERE ats = ? AND kind = ?').all(ats, group) as {
    strategy: Strategy
    worked: number
    failed: number
  }[]
  const score = new Map(rows.map((row) => [row.strategy, (row.worked + 1) / (row.worked + row.failed + 2)]))
  const base = STRATEGIES[group]
  return [...base].sort((a, b) => (score.get(b) ?? 0.5) - (score.get(a) ?? 0.5) || base.indexOf(a) - base.indexOf(b))
}

export function learn(ats: string, answer: PreparedAnswer, strategy: Strategy, held: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO form_lessons (ats, kind, strategy, worked, failed, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (ats, kind, strategy) DO UPDATE SET worked = worked + excluded.worked, failed = failed + excluded.failed, updated_at = excluded.updated_at`,
    )
    .run(ats, groupOf(answer), strategy, held ? 1 : 0, held ? 0 : 1, now())
}

export interface Files {
  cv: string | null
  cvName: string | null
  letter: Buffer | null
}

const YES = /^(yes|si|sí|true)$/i
const NO = /^(no|false)$/i
const TEXT_INPUT = 'textarea, input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])'

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const norm = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// The option that says what they answered: the same words, else the one that
// starts with them ("Yes" for "Yes, no restriction."), else the only one that
// holds them ("LinkedIn" in "Social media (LinkedIn, X…)"). Null when none
// does: an answer given for another form's options is not one of these.
export function optionFor(value: string, options: string[]): string | null {
  const wanted = norm(value)
  if (!wanted) return null
  const exact = options.find((option) => norm(option) === wanted)
  if (exact) return exact
  const starts = options.filter((option) => norm(option).startsWith(wanted) || wanted.startsWith(norm(option)))
  if (starts.length === 1) return starts[0]
  const word = new RegExp(`(^|[^a-z0-9])${escape(wanted)}($|[^a-z0-9])`)
  const holding = options.filter((option) => word.test(norm(option)))
  return holding.length === 1 ? holding[0] : null
}

// A number field takes the figure alone: "60,000 EUR" is 60000, "60k" 60000.
function numberIn(value: string): string | null {
  const match = value.replace(/(\d)[.,\s](?=\d{3}\b)/g, '$1').match(/(\d+(?:[.,]\d+)?)\s*(k\b)?/i)
  if (!match) return null
  const figure = Number(match[1].replace(',', '.')) * (match[2] ? 1000 : 1)
  return Number.isFinite(figure) ? String(figure) : null
}

// The control a field is filled through: the one the ATS names after the
// field, when it is of the kind wanted, else the first of that kind.
async function controlOf(page: Page, index: number, selector: string) {
  const own = page.locator(`[data-amble-control="${index}"]`)
  if ((await own.count()) > 0 && (await own.first().evaluate((el, wanted) => el.matches(wanted), selector))) return own.first()
  return page.locator(`[data-amble-field="${index}"]`).locator(selector).first()
}

const CHOICE_INPUT = '[role=combobox], input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file])'

// One way of filling one field. False when that way does not apply here.
export async function applyStrategy(page: Page, index: number, answer: PreparedAnswer, value: string | null, files: Files, strategy: Strategy): Promise<boolean> {
  const field = page.locator(`[data-amble-field="${index}"]`)
  const group = groupOf(answer)

  if (group === 'file') {
    const input = field.locator('input[type=file]').first()
    if ((await input.count()) === 0) return false
    if (answer.kind === 'resume' && files.cv) {
      const mimeType = files.cv.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'
      await input.setInputFiles({ name: files.cvName ?? 'CV.pdf', mimeType, buffer: fs.readFileSync(files.cv) })
      return true
    }
    if (answer.kind === 'cover_letter' && files.letter) {
      await input.setInputFiles({ name: 'Cover letter.pdf', mimeType: 'application/pdf', buffer: files.letter })
      return true
    }
    return false
  }
  if (value === null) return false

  if (group === 'yes_no') {
    const wanted = YES.test(value) ? /^(yes|sí|si)$/i : NO.test(value) ? /^no$/i : null
    if (!wanted) return false
    if (strategy === 'button') {
      const button = field.getByRole('button', { name: wanted }).first()
      if ((await button.count()) === 0) return false
      await button.click()
      return true
    }
    if (strategy === 'radio') {
      const radio = field.getByRole('radio', { name: wanted }).first()
      if ((await radio.count()) === 0) return false
      await radio.check()
      return true
    }
    const label = field.getByText(wanted).first()
    if ((await label.count()) === 0) return false
    await label.click()
    return true
  }

  const exact = new RegExp(`^\\s*${escape(value.trim())}\\s*$`, 'i')
  if (group === 'choice') {
    if (strategy === 'select') {
      const select = field.locator('select').first()
      if ((await select.count()) === 0) return false
      await select.selectOption({ label: value })
      return true
    }
    if (strategy === 'option_click') {
      const option = field.getByRole('radio', { name: exact }).or(field.getByRole('checkbox', { name: exact })).first()
      if ((await option.count()) === 0) return false
      await option.check()
      return true
    }
    if (strategy === 'label') {
      // Its box already ticked: a click on the label would untick it.
      const ticked = field.getByRole('radio', { name: exact, checked: true }).or(field.getByRole('checkbox', { name: exact, checked: true }))
      if ((await ticked.count()) > 0) return true
      const label = field.getByText(exact).first()
      if ((await label.count()) === 0) return false
      await label.click()
      return true
    }
  }

  const text = await controlOf(page, index, group === 'choice' ? CHOICE_INPUT : TEXT_INPUT)
  if ((await text.count()) === 0) return false
  const type = await text.getAttribute('type')
  let typed = value
  if (type === 'number') {
    const figure = numberIn(value)
    if (figure === null) return false
    typed = figure
  }
  // A date field (the browser's, or a date picker's box) takes a date, not
  // "in a month"; a picker's own format is not guessed.
  const picker = await text.evaluate((el) => /input-date|datepicker|pick date|\bdate\b/i.test(`${el.className} ${el.getAttribute('placeholder') ?? ''}`) && !(el as HTMLInputElement).type.includes('date'))
  if (picker || (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim()))) return false
  const typeIn = async (words: string) => {
    await text.click()
    await text.press('ControlOrMeta+A')
    await text.press('Delete')
    await text.pressSequentially(words, { delay: 15 })
  }
  // A search box with suggestions ("Start typing…" for a location, a list to
  // search in): the value counts only once one of its suggestions is chosen.
  const suggests = (await text.getAttribute('role')) === 'combobox' || (await text.getAttribute('aria-autocomplete')) !== null
  if (strategy === 'type') {
    await typeIn(typed)
    if (!suggests) return true
  } else if (suggests && strategy === 'suggest_match') {
    // Some lists open only to keys typed, not to a value pasted in (react-select).
    await typeIn(typed)
  } else {
    await text.fill(typed)
    if (strategy === 'fill_tab') {
      await text.press('Tab')
      return true
    }
    // A plain box has no suggestions to choose, and Enter in it could send the form.
    if (!suggests) return true
  }
  // Only the suggestions showing: a page keeps other lists hidden (a phone's countries).
  const options = page.locator('[role=option]:visible')
  await options.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  // A place search may know "Madrid" but not "Madrid, Spain".
  if ((await options.count()) === 0 && group === 'text' && value.includes(',')) {
    await typeIn(value.split(',')[0].trim())
    await options.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  }
  if ((await options.count()) === 0) {
    // A list to choose from takes nothing that is not in it.
    if (group === 'choice') return false
    await page.keyboard.press('Enter')
    return true
  }
  // The suggestion that says what they said; for a place, else one that names it.
  const shown = (await options.allTextContents()).map(norm)
  const wanted = norm(value)
  const place = norm(value.split(',')[0])
  const at = [shown.indexOf(wanted), shown.findIndex((option) => option.startsWith(wanted)), group === 'choice' ? -1 : shown.findIndex((option) => option.includes(place))].find(
    (position) => position >= 0,
  )
  if (at === undefined) {
    // A list to choose from: never an option other than theirs.
    if (group === 'choice') {
      await page.keyboard.press('Escape')
      return false
    }
    await options.first().click()
    return true
  }
  await options.nth(at).click()
  return true
}

// Whether the field now holds what was put in it, read back from the page:
// the control's value, the option chosen, the file attached, and no error
// shown next to it. Unknown (a control it cannot read) counts as held.
const READ_BACK = String.raw`([index, kind, wanted, fileName]) => {
  const field = document.querySelector('[data-amble-field="' + index + '"]')
  if (!field) return 'missing'
  const norm = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  const own = document.querySelector('[data-amble-control="' + index + '"]')
  // An error message showing, not a style: a board marks a label or a control
  // as in error until it checks the field again.
  const error = Array.from(field.querySelectorAll('[role=alert], [id$="-error"], [class*=error i]'))
    .some((el) => !el.matches('label, legend, input, textarea, select') && !el.querySelector('input, textarea, select, label, legend') && el.getClientRects().length > 0 && norm(el.textContent).length > 2)
  // The same answer. An option is the same words (a long one may show cut
  // short); a text may be rewritten by a suggestion box ("Valencia" shown as
  // "Valencia, Spain", "Madrid, Spain" as "Madrid, Community of Madrid, Spain").
  const same = (shown) => {
    const a = norm(shown)
    const b = norm(wanted)
    if (!a || !b) return false
    if (a === b) return true
    if (kind === 'choice' || kind === 'yes_no') return Math.min(a.length, b.length) >= 20 && (a.startsWith(b) || b.startsWith(a))
    if (a.includes(b.slice(0, 12)) || b.includes(a.slice(0, 12))) return true
    const place = b.split(',')[0].trim()
    return b.includes(',') && place.length >= 3 && a.startsWith(place)
  }
  if (kind === 'file') {
    const input = field.querySelector('input[type=file]')
    const attached = (input && input.files && input.files.length > 0) || (fileName && norm(field.textContent).includes(norm(fileName).slice(0, 12)))
    return attached && !error ? 'held' : 'not_held'
  }
  if (kind === 'yes_no' || kind === 'choice') {
    const select = field.querySelector('select')
    if (select) return norm(select.selectedOptions[0] && select.selectedOptions[0].textContent) === norm(wanted) && !error ? 'held' : 'not_held'
    // The box ticked or the button pressed, and it is the one they said.
    const checked = Array.from(field.querySelectorAll('input:checked, [aria-checked=true], [aria-pressed=true], [aria-selected=true], [data-state=checked], [data-state=on]'))
    if (checked.length > 0) {
      const named = (el) => {
        const labels = el.labels && el.labels.length ? Array.from(el.labels).map((label) => label.textContent).join(' ') : ''
        return labels || el.getAttribute('aria-label') || el.textContent || (el.parentElement && el.parentElement.textContent) || ''
      }
      const texts = checked.map(named).filter((text) => norm(text))
      return texts.length === 0 || texts.some(same) ? 'held' : 'not_held'
    }
    // A list that shows the option chosen beside its search box (react-select).
    const shown = Array.from(field.querySelectorAll('[class*=single-value i], [class*=singleValue], [class*=multi-value__label i], [class*=multiValue]')).map((el) => el.textContent)
    if (shown.length > 0) return shown.some(same) && !error ? 'held' : 'not_held'
    const input = own || field.querySelector('[role=combobox], input:not([type=hidden])')
    if (input && 'value' in input && norm(input.value)) return same(input.value) && !error ? 'held' : 'not_held'
    // A list to search in with nothing chosen: it did not take.
    if (input && input.getAttribute('role') === 'combobox') return 'not_held'
    // A button group that shows its choice only by style: cannot tell.
    return error ? 'not_held' : 'unknown'
  }
  const input = (own && own.matches('textarea, input') ? own : null) || field.querySelector('textarea, input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])')
  if (!input) return 'unknown'
  const value = norm(input.value)
  // A search box that shows the suggestion chosen beside it, and empties itself.
  if (!value && input.getAttribute('role') === 'combobox') {
    const shown = Array.from(field.querySelectorAll('[class*=single-value i], [class*=singleValue]')).map((el) => el.textContent)
    return shown.some(same) && !error ? 'held' : 'not_held'
  }
  if (!value) return 'not_held'
  if (input.type === 'number') return /\d/.test(value) && !error ? 'held' : 'not_held'
  return same(input.value) && !error ? 'held' : 'not_held'
}`

export async function holds(page: Page, index: number, answer: PreparedAnswer, value: string | null, files: Files): Promise<boolean> {
  const group = groupOf(answer)
  const fileName = answer.kind === 'resume' ? files.cvName : answer.kind === 'cover_letter' ? 'Cover letter' : null
  const result = (await page
    .evaluate(`(${READ_BACK})(${JSON.stringify([index, group, value ?? '', fileName])})`)
    .catch(() => 'unknown')) as 'held' | 'not_held' | 'unknown' | 'missing'
  return result === 'held' || result === 'unknown'
}
