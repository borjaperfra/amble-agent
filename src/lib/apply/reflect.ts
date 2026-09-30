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

  if (group === 'choice') {
    if (strategy === 'select') {
      const select = field.locator('select').first()
      if ((await select.count()) === 0) return false
      await select.selectOption({ label: value })
      return true
    }
    if (strategy === 'option_click') {
      const option = field.getByRole('radio', { name: value }).or(field.getByRole('checkbox', { name: value })).first()
      if ((await option.count()) === 0) return false
      await option.check()
      return true
    }
    if (strategy === 'label') {
      const label = field.getByText(new RegExp(`^\\s*${escape(value)}\\s*$`, 'i')).first()
      if ((await label.count()) === 0) return false
      await label.click()
      return true
    }
  }

  const text = field.locator(group === 'choice' ? '[role=combobox], input' : TEXT_INPUT).first()
  if ((await text.count()) === 0) return false
  if (strategy === 'type') {
    await text.click()
    await text.press('ControlOrMeta+A')
    await text.press('Delete')
    await text.pressSequentially(value, { delay: 15 })
    return true
  }
  await text.fill(value)
  if (strategy === 'fill_tab') {
    await text.press('Tab')
    return true
  }
  // A search box with suggestions ("Start typing…" for a location): the value
  // counts only once one of its suggestions is chosen.
  const suggests = (await text.getAttribute('role')) === 'combobox' || (await text.getAttribute('aria-autocomplete')) !== null
  if (strategy === 'fill' && !suggests) return true
  if (!suggests && strategy !== 'suggest_match') return true
  const options = page.getByRole('option')
  await options.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  if ((await options.count()) === 0) {
    await page.keyboard.press('Enter')
    return true
  }
  // The suggestion that names what they said, else the first one.
  const named = page.getByRole('option', { name: new RegExp(escape(value.split(',')[0].trim()), 'i') }).first()
  await ((strategy === 'suggest_match' || strategy === 'suggest_first') && (await named.count()) > 0 ? named : options.first()).click()
  return true
}

// Whether the field now holds what was put in it, read back from the page:
// the control's value, the option chosen, the file attached, and no error
// shown next to it. Unknown (a control it cannot read) counts as held.
const READ_BACK = String.raw`([index, kind, wanted, fileName]) => {
  const field = document.querySelector('[data-amble-field="' + index + '"]')
  if (!field) return 'missing'
  const norm = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  const error = Array.from(field.querySelectorAll('[role=alert], [aria-invalid=true], [class*=error i]'))
    .some((el) => el.getAttribute('aria-invalid') === 'true' || norm(el.textContent).length > 2)
  if (kind === 'file') {
    const input = field.querySelector('input[type=file]')
    const attached = (input && input.files && input.files.length > 0) || (fileName && norm(field.textContent).includes(norm(fileName).slice(0, 12)))
    return attached && !error ? 'held' : 'not_held'
  }
  if (kind === 'yes_no' || kind === 'choice') {
    const select = field.querySelector('select')
    if (select) return norm(select.selectedOptions[0] && select.selectedOptions[0].textContent) === norm(wanted) && !error ? 'held' : 'not_held'
    const checked = field.querySelector('input:checked, [aria-checked=true], [aria-pressed=true], [aria-selected=true], [data-state=checked], [data-state=on]')
    if (checked) return error ? 'not_held' : 'held'
    const input = field.querySelector('[role=combobox], input:not([type=hidden])')
    if (input && 'value' in input && norm(input.value)) return error ? 'not_held' : 'held'
    // A button group that shows its choice only by style: cannot tell.
    return error ? 'not_held' : 'unknown'
  }
  const input = field.querySelector('textarea, input:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])')
  if (!input) return 'unknown'
  const value = norm(input.value)
  if (!value) return 'not_held'
  // A suggestion box may rewrite "Valencia" as "Valencia, Spain": the start is enough.
  const start = norm(wanted).slice(0, 12)
  return (value.includes(start) || norm(wanted).includes(value.slice(0, 12))) && !error ? 'held' : 'not_held'
}`

export async function holds(page: Page, index: number, answer: PreparedAnswer, value: string | null, files: Files): Promise<boolean> {
  const group = groupOf(answer)
  const fileName = answer.kind === 'resume' ? files.cvName : answer.kind === 'cover_letter' ? 'Cover letter' : null
  const result = (await page
    .evaluate(`(${READ_BACK})(${JSON.stringify([index, group, value ?? '', fileName])})`)
    .catch(() => 'unknown')) as 'held' | 'not_held' | 'unknown' | 'missing'
  return result === 'held' || result === 'unknown'
}
