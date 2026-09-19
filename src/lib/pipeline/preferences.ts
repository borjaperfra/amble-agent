import { getPreferences, parseJsonArray, savePreferences } from '../db/repo'

/**
 * What the candidate will take, in terms that can be checked against a real
 * opportunity.
 *
 * The free-text intent produced things like "good economic offer" and
 * "respect my autonomy". Both are true and neither can be matched against a
 * job posting, which is the whole point of listening. This is the other half:
 * a salary floor, a way of working, a place, a stack, a size of company.
 */

export const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const
export type WorkMode = (typeof WORK_MODES)[number]

export interface Preferences {
  salaryMin: number | null
  salaryCurrency: string
  workMode: WorkMode | null
  location: string | null
  technologies: string[]
  stages: string[]
  notes: string | null
  /**
   * Where to reach them, as a list.
   *
   * It used to be one value with "both" as a third option, which worked
   * while there were exactly two ways to reach anyone. A list says the same
   * thing without having to invent a word every time one is added.
   */
  notifyChannels: NotifyChannel[]
  notifyEmail: string | null
  notifyWhatsapp: string | null
  notifyTelegram: string | null
}

export const NOTIFY_CHANNELS = ['email', 'whatsapp', 'telegram'] as const
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]

export const EMPTY_PREFERENCES: Preferences = {
  salaryMin: null,
  salaryCurrency: 'EUR',
  workMode: null,
  location: null,
  technologies: [],
  stages: [],
  notes: null,
  notifyChannels: [],
  notifyEmail: null,
  notifyWhatsapp: null,
  notifyTelegram: null,
}

function asWorkMode(value: string | null): WorkMode | null {
  return value && (WORK_MODES as readonly string[]).includes(value) ? (value as WorkMode) : null
}

/**
 * Read the column either way. Somebody who picked "both" before this was a
 * list should not have to say it again.
 */
function asChannels(value: string | null): NotifyChannel[] {
  if (!value) return []
  if (value === 'both') return ['email', 'whatsapp']
  const seen = new Set<string>()
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is NotifyChannel => {
      if (seen.has(item) || !(NOTIFY_CHANNELS as readonly string[]).includes(item)) return false
      seen.add(item)
      return true
    })
}

export function readPreferences(candidateId: string): Preferences {
  const row = getPreferences(candidateId)
  if (!row) return { ...EMPTY_PREFERENCES }
  return {
    salaryMin: row.salary_min,
    salaryCurrency: row.salary_currency ?? 'EUR',
    workMode: asWorkMode(row.work_mode),
    location: row.location,
    technologies: parseJsonArray(row.technologies),
    stages: parseJsonArray(row.stages),
    notes: row.notes,
    notifyChannels: asChannels(row.notify_channel),
    notifyEmail: row.notify_email,
    notifyWhatsapp: row.notify_whatsapp,
    notifyTelegram: row.notify_telegram,
  }
}

const trim = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, max)
  return text.length > 0 ? text : null
}

const list = (value: unknown, limit: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = trim(item, 60)
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/** Whatever of this the caller sent, validated. Everything else is left alone. */
export function writePreferences(candidateId: string, input: Record<string, unknown>): Preferences {
  const patch: Parameters<typeof savePreferences>[1] = {}

  if ('salaryMin' in input) {
    const value = Number(input.salaryMin)
    patch.salary_min = Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }
  if ('salaryCurrency' in input) patch.salary_currency = trim(input.salaryCurrency, 8)?.toUpperCase() ?? 'EUR'
  if ('workMode' in input) patch.work_mode = asWorkMode(trim(input.workMode, 20))
  if ('location' in input) patch.location = trim(input.location, 80)
  if ('notes' in input) patch.notes = trim(input.notes, 500)
  if ('notifyChannels' in input) {
    const channels = Array.isArray(input.notifyChannels)
      ? asChannels(input.notifyChannels.map((value) => String(value)).join(','))
      : []
    patch.notify_channel = channels.length > 0 ? channels.join(',') : null
  }
  if ('notifyEmail' in input) patch.notify_email = trim(input.notifyEmail, 160)
  if ('notifyWhatsapp' in input) patch.notify_whatsapp = trim(input.notifyWhatsapp, 40)
  if ('notifyTelegram' in input) patch.notify_telegram = trim(input.notifyTelegram, 40)

  const technologies = list(input.technologies, 12)
  if (technologies) patch.technologies = JSON.stringify(technologies)
  const stages = list(input.stages, 6)
  if (stages) patch.stages = JSON.stringify(stages)

  savePreferences(candidateId, patch)
  return readPreferences(candidateId)
}

export interface ExtractedPreferences {
  salaryMin: number | null
  salaryCurrency: string | null
  workMode: string | null
  location: string | null
  technologies: string[]
  stages: string[]
}

/**
 * Fill in what the candidate's own words already said, and nothing else.
 *
 * Only blanks: a figure they typed into the form themselves outranks one the
 * model read between the lines, however confident it sounded.
 */
export function applyExtractedPreferences(
  candidateId: string,
  extracted: ExtractedPreferences,
): Preferences {
  const current = readPreferences(candidateId)
  const patch: Record<string, unknown> = {}

  if (current.salaryMin === null && extracted.salaryMin !== null) {
    patch.salaryMin = extracted.salaryMin
    patch.salaryCurrency = extracted.salaryCurrency ?? 'EUR'
  }
  if (current.workMode === null && extracted.workMode) patch.workMode = extracted.workMode
  if (current.location === null && extracted.location) patch.location = extracted.location
  if (current.technologies.length === 0 && extracted.technologies.length > 0) {
    patch.technologies = extracted.technologies
  }
  if (current.stages.length === 0 && extracted.stages.length > 0) patch.stages = extracted.stages

  if (Object.keys(patch).length === 0) return current
  return writePreferences(candidateId, patch)
}

/** The concrete lines the Listening screen shows, in plain words. */
export function preferencesAsLines(preferences: Preferences): string[] {
  const lines: string[] = []
  if (preferences.salaryMin !== null) {
    lines.push(
      `From ${preferences.salaryMin.toLocaleString('en-US').replace(/,/g, '.')} ${preferences.salaryCurrency}`,
    )
  }
  if (preferences.workMode) {
    lines.push(
      preferences.workMode === 'remote'
        ? 'Remote'
        : preferences.workMode === 'hybrid'
          ? 'Hybrid'
          : 'On-site',
    )
  }
  if (preferences.location) lines.push(preferences.location)
  lines.push(...preferences.technologies)
  lines.push(...preferences.stages)
  return lines
}
