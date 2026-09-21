import { z } from 'zod'
import { runStructuredTask } from './provider'
import { languageInstruction } from '@/lib/copy'
import { readPreferences } from '../pipeline/preferences'

/**
 * En qué idioma tiene que escribir lo que esta persona va a leer.
 *
 * Solo se le dice a las tareas cuyo texto sale a la pantalla o al mensaje:
 * la pregunta de la entrevista, el descriptor y cómo queda ordenado su
 * intent. La extracción de claims no lo lleva a propósito — la evidencia es
 * casi una cita del documento, y traducirla la aleja de lo que ponía.
 */
function writeFor(candidateId: string): string {
  return languageInstruction(readPreferences(candidateId).language)
}

export const EVIDENCE_ASSESSMENTS = [
  'STRONG_EVIDENCE',
  'GOOD_EVIDENCE',
  'SOME_EVIDENCE',
  'LIMITED_EVIDENCE',
  'NO_EVIDENCE_YET',
  'CONTRADICTORY_EVIDENCE',
] as const

const claimTypeSchema = z.enum(['experience', 'project', 'metric', 'skill', 'education', 'other'])

const epistemicSchema = z.enum(['SOURCE_FACT', 'USER_CLAIM'])

interface RawClaimShape {
  statement?: unknown
  claim?: unknown
  text?: unknown
  claimType?: unknown
  type?: unknown
  kind?: unknown
  epistemicState?: unknown
  epistemic?: unknown
  confidence?: unknown
  requiresConfirmation?: unknown
  sourceExcerpt?: unknown
  sourceLocation?: unknown
  possibleCapabilities?: unknown
}

const epistemicValues = ['SOURCE_FACT', 'USER_CLAIM'] as const

function normalizeClaim(raw: unknown, defaultEpistemic: (typeof epistemicValues)[number]): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as RawClaimShape
  const statement = typeof c.statement === 'string' ? c.statement : typeof c.claim === 'string' ? c.claim : typeof c.text === 'string' ? c.text : null
  if (!statement || statement.trim().length < 3) return null
  const rawType = typeof c.claimType === 'string' ? c.claimType : typeof c.type === 'string' ? c.type : null
  const claimType = ['experience', 'project', 'metric', 'skill', 'education', 'other'].includes(rawType ?? '')
    ? (rawType as string)
    : 'other'
  const rawEpistemic = typeof c.epistemicState === 'string' ? c.epistemicState : typeof c.epistemic === 'string' ? c.epistemic : null
  const epistemicKnown = epistemicValues.includes(rawEpistemic as (typeof epistemicValues)[number])
  const epistemicState = epistemicKnown ? rawEpistemic : defaultEpistemic
  const requiresConfirmation = epistemicKnown ? c.requiresConfirmation === true : true
  const excerpt = typeof c.sourceExcerpt === 'string' && c.sourceExcerpt.trim().length >= 3 ? c.sourceExcerpt : null
  return {
    statement: statement.trim().slice(0, 400),
    claimType,
    epistemicState,
    sourceExcerpt: excerpt ? excerpt.trim().slice(0, 600) : null,
    sourceLocation: typeof c.sourceLocation === 'string' ? c.sourceLocation.slice(0, 40) : null,
    confidence: typeof c.confidence === 'number' && c.confidence >= 0 && c.confidence <= 1 ? c.confidence : 0.75,
    requiresConfirmation,
    possibleCapabilities: Array.isArray(c.possibleCapabilities)
      ? c.possibleCapabilities
          .filter((s): s is string => typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 60)
          .slice(0, 8)
      : [],
  }
}

function normalizeClaimArray(raw: unknown, defaultEpistemic: (typeof epistemicValues)[number]): unknown[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => normalizeClaim(item, defaultEpistemic))
    .filter((item): item is Record<string, unknown> => item !== null)
    .slice(0, 50)
}

const normalizedClaim = z.object({
  statement: z.string().min(3).max(400),
  claimType: claimTypeSchema,
  epistemicState: epistemicSchema,
  sourceExcerpt: z.string().max(600).nullable(),
  sourceLocation: z.string().max(40).nullable(),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean(),
  possibleCapabilities: z.array(z.string().min(2).max(60)).max(8),
})

export const extractClaimsOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as { candidateName?: unknown; claims?: unknown }
    return {
      candidateName: typeof obj.candidateName === 'string' && obj.candidateName.trim().length >= 2 ? obj.candidateName.trim().slice(0, 120) : null,
      claims: normalizeClaimArray(obj.claims, 'SOURCE_FACT'),
    }
  },
  z.object({
    candidateName: z.string().min(2).max(120).nullable(),
    claims: z.array(normalizedClaim).max(50),
  }),
)

export type ExtractClaimsOutput = z.infer<typeof extractClaimsOutputSchema>

const capabilityAssessmentSchema = z.object({
  name: z.string().min(2).max(60),
  slug: z.string().min(2).max(60),
  assessment: z.enum(EVIDENCE_ASSESSMENTS),
  evidenceIds: z.array(z.string().min(1)).max(80),
  reason: z.string().min(3).max(600),
  uncertainties: z
    .array(
      z.object({
        description: z.string().min(3).max(400),
        materiality: z.enum(['HIGH', 'MEDIUM', 'LOW']),
      }),
    )
    .max(6),
})

const ASSESSMENT_VALUES = [
  'STRONG_EVIDENCE',
  'GOOD_EVIDENCE',
  'SOME_EVIDENCE',
  'LIMITED_EVIDENCE',
  'NO_EVIDENCE_YET',
  'CONTRADICTORY_EVIDENCE',
] as const

type CapabilityAssessment = {
  name: string
  slug: string
  assessment: string
  evidenceIds: string[]
  reason: string
  uncertainties: { description: string; materiality: string }[]
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

function normalizeAssessment(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const upper = raw.toUpperCase().replace(/\s+/g, '_')
  if ((ASSESSMENT_VALUES as readonly string[]).includes(upper)) return upper
  if (['STRONG', 'GOOD', 'SOME', 'LIMITED'].includes(upper)) return `${upper}_EVIDENCE`
  if (upper === 'NO_EVIDENCE' || upper === 'NONE') return 'NO_EVIDENCE_YET'
  if (upper === 'CONTRADICTORY') return 'CONTRADICTORY_EVIDENCE'
  return ''
}

/**
 * Internal ids the model likes to cite back at us. They are real and they
 * are useful in a trace, but a candidate reading "Talent Engine was
 * discontinued (ev_5ae44c8f6ee94bbb)" is being shown our filing system.
 */
const INTERNAL_ID = /\s*\(?(?:ev|clm|unc|src|turn|cap|run|job|intn)_[0-9a-f]{6,}\)?/g

export function stripInternalIds(text: string): string {
  return text
    .replace(INTERNAL_ID, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Keys that hold an identifier or an enum, never a sentence. */
const NOT_PROSE = /^(id|ids|slug|kind|type|level|materiality|assessment|status|confidence)$|Ids?$/i

/**
 * The one piece of prose in a small object, whatever the model decided to
 * call it this time.
 *
 * Without server-side JSON mode the field names drift between runs: a
 * description came back as `text` once and as `whyItMatters` another time,
 * and every one of those was dropped on the floor, which emptied the
 * interview of anything to ask about. Try the names we know, then take the
 * longest sentence-shaped value that is left rather than lose the answer
 * over a key nobody predicted.
 */
export function firstProse(value: Record<string, unknown>, preferred: string[], minLength = 3): string | null {
  for (const key of preferred) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim().length >= minLength) return candidate.trim()
  }
  let best: string | null = null
  for (const [key, candidate] of Object.entries(value)) {
    if (NOT_PROSE.test(key) || typeof candidate !== 'string') continue
    const text = candidate.trim()
    if (text.length < Math.max(minLength, 12)) continue
    if (!best || text.length > best.length) best = text
  }
  return best
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim()
}

function normalizeCapability(raw: unknown): CapabilityAssessment | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const name =
    typeof c.name === 'string' && c.name.trim().length >= 2
      ? c.name.trim()
      : typeof c.capability === 'string' && c.capability.trim().length >= 2
        ? c.capability.trim()
        : typeof c.title === 'string' && c.title.trim().length >= 2
          ? c.title.trim()
          : null
  const slug = typeof c.slug === 'string' && c.slug.trim().length >= 2 ? normalizeSlug(c.slug) : null
  if (!name && !slug) return null
  const resolvedName = (name ?? prettifySlug(slug as string)).slice(0, 60)
  const assessment = normalizeAssessment(
    c.assessment ??
      c.assessmentLevel ??
      c.assessment_level ??
      c.level ??
      c.evidenceLevel ??
      c.evidence_level ??
      c.strength,
  )
  if (!assessment) return null
  const rawEvidenceIds = c.evidenceIds ?? c.evidence ?? c.supportingEvidence ?? c.evidence_ids
  const evidenceIds = Array.isArray(rawEvidenceIds)
    ? rawEvidenceIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 80)
    : []
  const reason =
    typeof c.reason === 'string' && c.reason.trim().length >= 3
      ? c.reason
      : typeof c.rationale === 'string'
        ? c.rationale
        : typeof c.explanation === 'string'
          ? c.explanation
          : ''
  if (reason.trim().length < 3) return null
  const rawUncertainties = Array.isArray(c.uncertainties) ? c.uncertainties : []
  const uncertainties = rawUncertainties
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim().length >= 3 ? { description: item.trim().slice(0, 400), materiality: 'MEDIUM' } : null
      }
      const u = (item ?? {}) as Record<string, unknown>
      const description = firstProse(u, [
        'description',
        'uncertainty',
        'statement',
        'text',
        'gap',
        'question',
        'whyItMatters',
      ])
      if (!description) return null
      const materiality = ['HIGH', 'MEDIUM', 'LOW'].includes(u.materiality as string)
        ? (u.materiality as string)
        : 'MEDIUM'
      return { description: stripInternalIds(description).slice(0, 400), materiality }
    })
    .filter((item): item is { description: string; materiality: string } => item !== null)
    .slice(0, 6)
  return {
    name: resolvedName,
    slug: slug ?? normalizeSlug(resolvedName),
    assessment,
    evidenceIds,
    reason: stripInternalIds(reason).slice(0, 600),
    uncertainties,
  }
}

export const assessCapabilitiesOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as { capabilities?: unknown }
    const list = Array.isArray(obj.capabilities) ? obj.capabilities : []
    const capabilities = list
      .map((item) => normalizeCapability(item))
      .filter((item): item is CapabilityAssessment => item !== null)
      .slice(0, 20)
    const offeredUncertainties = list.reduce((total, item) => {
      const raw = (item ?? {}) as { uncertainties?: unknown }
      return total + (Array.isArray(raw.uncertainties) ? raw.uncertainties.length : 0)
    }, 0)
    const keptUncertainties = capabilities.reduce(
      (total, capability) => total + capability.uncertainties.length,
      0,
    )
    // Carried only so the checks below can see them; stripped again afterwards.
    return { capabilities, offered: list.length, offeredUncertainties, keptUncertainties }
  },
  z
    .object({
      capabilities: z.array(capabilityAssessmentSchema).max(20),
      offered: z.number().optional(),
      offeredUncertainties: z.number().optional(),
      keptUncertainties: z.number().optional(),
    })
    // The model answering with capabilities that all fail normalization used to
    // pass as a clean run with nothing in it: no capabilities, no uncertainties,
    // and an interview left asking generic questions into the void. Treat it as
    // what it is, a bad answer, so it is retried and then fails out loud.
    .refine((value) => value.capabilities.length > 0 || !value.offered, {
      message:
        'every capability in the response was unusable: each needs a name, an assessment level and a reason',
    })
    // An assessment with no uncertainties leaves the interview with nothing to
    // ask about, so losing all of them to a renamed field has to be loud too.
    .refine((value) => !value.offeredUncertainties || (value.keptUncertainties ?? 0) > 0, {
      message:
        'every uncertainty was unusable: each needs a description and a materiality of HIGH, MEDIUM or LOW',
    })
    .transform(({ capabilities }) => ({ capabilities })),
)

export type AssessCapabilitiesOutput = z.infer<typeof assessCapabilitiesOutputSchema>

export const reassessOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const assessments = Array.isArray(obj.assessments) ? obj.assessments : []
    const newUncertainties = Array.isArray(obj.newUncertainties) ? obj.newUncertainties : []
    type NewUncertainty = { capabilitySlug: string | null; description: string; materiality: string }
    return {
      assessments: assessments
        .map((item) => normalizeCapability(item))
        .filter((item): item is CapabilityAssessment => item !== null)
        .slice(0, 20),
      // Normalized rather than passed through: one update missing an id, or a
      // note one character over the limit, used to fail the whole response and
      // cost a full retry — around 30s of the candidate's time.
      uncertaintyUpdates: (Array.isArray(obj.uncertaintyUpdates) ? obj.uncertaintyUpdates : [])
        .map((item) => {
          const u = (item ?? {}) as Record<string, unknown>
          const id =
            typeof u.id === 'string' && u.id.trim().length > 0
              ? u.id.trim()
              : typeof u.uncertaintyId === 'string' && u.uncertaintyId.trim().length > 0
                ? u.uncertaintyId.trim()
                : null
          if (!id) return null
          const rawStatus = typeof u.status === 'string' ? u.status.toUpperCase().replace(/\s+/g, '_') : ''
          const status = ['OPEN', 'RESOLVED', 'ACCEPTED_UNKNOWN'].includes(rawStatus) ? rawStatus : 'OPEN'
          const note = typeof u.note === 'string' ? u.note.trim().slice(0, 400) : null
          return { id, status, note: note && note.length > 0 ? note : null }
        })
        .filter((item): item is { id: string; status: string; note: string | null } => item !== null)
        .slice(0, 40),
      newUncertainties: newUncertainties
        .map((item): NewUncertainty | null => {
          const u = (item ?? {}) as Record<string, unknown>
          const description =
            typeof u.description === 'string' && u.description.trim().length >= 3
              ? u.description
              : typeof u.statement === 'string' && u.statement.trim().length >= 3
                ? u.statement
                : null
          if (!description) return null
          const materiality = ['HIGH', 'MEDIUM', 'LOW'].includes(u.materiality as string)
            ? (u.materiality as string)
            : 'MEDIUM'
          return {
            capabilitySlug: typeof u.capabilitySlug === 'string' ? u.capabilitySlug : typeof u.capability === 'string' ? u.capability : null,
            description: description.trim().slice(0, 400),
            materiality,
          }
        })
        .filter((item): item is NewUncertainty => item !== null)
        .slice(0, 10),
    }
  },
  z.object({
    assessments: z.array(capabilityAssessmentSchema).max(20),
    uncertaintyUpdates: z
      .array(
        z.object({
          id: z.string().min(1),
          status: z.enum(['OPEN', 'RESOLVED', 'ACCEPTED_UNKNOWN']),
          note: z.string().max(400).nullable().optional(),
        }),
      )
      .max(40),
    newUncertainties: z.array(
      z.object({
        capabilitySlug: z.string().max(60).nullable().optional(),
        description: z.string().min(3).max(400),
        materiality: z.enum(['HIGH', 'MEDIUM', 'LOW']),
      }),
    ),
  }),
)

export type ReassessOutput = z.infer<typeof reassessOutputSchema>

export const planNextQuestionOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const action = typeof obj.action === 'string' ? obj.action.toUpperCase() : 'ASK'
    return {
      ...obj,
      action: action === 'STOP' ? 'STOP' : 'ASK',
      question: typeof obj.question === 'string' ? obj.question.trim().slice(0, 480) : null,
      reason: typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 480) : '',
    }
  },
  z
    .object({
      action: z.enum(['ASK', 'STOP']),
      question: z.string().min(10).max(500).nullable(),
      reason: z.string().min(3).max(500),
      targetCapabilityIds: z.array(z.string().min(1)).max(6).catch([]),
      targetUncertaintyIds: z.array(z.string().min(1)).max(6).catch([]),
    })
    .superRefine((value, ctx) => {
      if (value.action === 'ASK' && !value.question) {
        ctx.addIssue({ code: 'custom', message: 'ASK requires a question', path: ['question'] })
      }
    }),
)

export type PlanNextQuestionOutput = z.infer<typeof planNextQuestionOutputSchema>

export const answerClaimsOutputSchema = z.preprocess(
  (raw) => ({ claims: normalizeClaimArray((raw as { claims?: unknown } | null)?.claims, 'USER_CLAIM') }),
  z.object({
    claims: z.array(normalizedClaim).max(20),
  }),
)

export type AnswerClaimsOutput = z.infer<typeof answerClaimsOutputSchema>

/**
 * La respuesta del Rep, normalizada con la misma tolerancia que las demás.
 *
 * Un modelo que se deja `unknowns` fuera, o que lo manda como texto en vez de
 * lista, no vale un reintento de treinta segundos por una pregunta que el
 * candidato está esperando en el móvil.
 */
export const candidateAnswerOutputSchema = z.preprocess(
  (raw) => {
    const value = (raw ?? {}) as Record<string, unknown>
    // Cada cosa dicha va con lo que la sostiene. Tolerante con los nombres,
    // que se mueven entre runs, y con los ids sueltos en vez de listas.
    const ids = (value: unknown): string[] =>
      (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => id.length > 0)
        .slice(0, 8)

    const points = (Array.isArray(value.points) ? value.points : [])
      .map((item) => {
        const entry = (item ?? {}) as Record<string, unknown>
        const text = typeof entry.text === 'string' ? entry.text.trim() : ''
        if (text.length === 0) return null
        return {
          text: text.slice(0, 600),
          evidenceIds: ids(entry.evidenceIds),
          uncertaintyIds: ids(entry.uncertaintyIds),
          opportunityIds: ids(entry.opportunityIds),
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 6)

    const askBack =
      typeof value.askBack === 'string' && value.askBack.trim().length > 0
        ? value.askBack.trim().slice(0, 400)
        : null
    const unknowns = Array.isArray(value.unknowns)
      ? value.unknowns
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
          .slice(0, 2)
      : []
    // Lo que queda dicho entre los dos. Tolerante con los nombres de campo
    // porque se mueven entre runs, y con un tope bajo a proposito: tres cosas
    // que recordar de una conversacion ya son muchas.
    const remember = (Array.isArray(value.remember) ? value.remember : [])
      .map((item) => {
        const entry = (item ?? {}) as Record<string, unknown>
        const text = typeof entry.text === 'string' ? entry.text.trim() : ''
        if (text.length === 0) return null
        const ids = (key: string) =>
          (Array.isArray(entry[key]) ? (entry[key] as unknown[]) : [])
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id) => id.length > 0)
            .slice(0, 8)
        const side = entry.side === 'candidate' ? 'candidate' : 'rep'
        return {
          side,
          text: text.slice(0, 600),
          uncertaintyIds: ids('uncertaintyIds'),
          opportunityIds: ids('opportunityIds'),
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 3)
    return { points, askBack, unknowns, remember }
  },
  z.object({
    points: z
      .array(
        z.object({
          text: z.string().min(1).max(600),
          evidenceIds: z.array(z.string()).max(8),
          uncertaintyIds: z.array(z.string()).max(8),
          opportunityIds: z.array(z.string()).max(8),
        }),
      )
      .max(6),
    askBack: z.string().max(400).nullable(),
    unknowns: z.array(z.string().max(300)).max(2),
    remember: z
      .array(
        z.object({
          side: z.enum(['rep', 'candidate']),
          text: z.string().min(1).max(600),
          uncertaintyIds: z.array(z.string()).max(8),
          opportunityIds: z.array(z.string()).max(8),
        }),
      )
      .max(3),
  }),
)

export type CandidateAnswerOutput = z.infer<typeof candidateAnswerOutputSchema>

export const distinctiveProfileOutputSchema = z.object({
  capabilityIds: z.array(z.string().min(1)).max(3),
})

export type DistinctiveProfileOutput = z.infer<typeof distinctiveProfileOutputSchema>

export const descriptorOutputSchema = z.object({
  descriptor: z.string().min(3).max(140),
})

export type DescriptorOutput = z.infer<typeof descriptorOutputSchema>

const intentLabelSchema = z.enum([
  'Role',
  'Space',
  'Company',
  'Compensation',
  'Ownership',
  'Location',
  'Not interested in',
  'Other',
])

/**
 * A salary as a number, however it was written: 65000, "65k", "65.000 EUR",
 * "€65,000". Anything under a thousand is read as thousands, because nobody
 * means an annual salary of sixty-five euros.
 */
export function toAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null
  if (typeof raw !== 'string') return null

  const text = raw.trim().toLowerCase()
  // The first number only: "between 60k and 70k" is a floor of sixty
  // thousand, not six million.
  const match = text.match(/(\d[\d.,]*)\s*(k)?/)
  if (!match) return null

  // A dot or comma followed by exactly three digits is a thousands mark in
  // one convention or the other; anything else is a decimal point.
  const digits = match[1].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(/,/g, '.')
  const value = Number.parseFloat(digits)
  if (!Number.isFinite(value) || value <= 0) return null

  let amount = match[2] ? value * 1000 : value
  // Nobody means an annual salary of sixty-five euros.
  if (amount < 1000) amount *= 1000
  // Turning a monthly figure they called monthly into a yearly one is
  // arithmetic, not a guess.
  if (/per month|a month|\/mo\b|monthly|al mes|mensual/.test(text)) amount *= 12
  return Math.round(amount)
}

const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const

export function normalizeWorkMode(raw: unknown): (typeof WORK_MODES)[number] | null {
  if (typeof raw === 'boolean') return raw ? 'remote' : 'onsite'
  if (typeof raw !== 'string') return null
  const text = raw.trim().toLowerCase()
  const exact = WORK_MODES.find((mode) => mode === text)
  if (exact) return exact
  if (/hybrid|mixed|mix|part.?remote|some days/.test(text)) return 'hybrid'
  if (/remote|anywhere|distributed|wfh|teletrabajo/.test(text)) return 'remote'
  if (/onsite|on.site|office|presencial|in.person/.test(text)) return 'onsite'
  return null
}

export function normalizeList(raw: unknown, limit = 12): string[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,;\/]| and /i)
      : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of source) {
    if (typeof item !== 'string') continue
    const text = item.trim().slice(0, 60)
    if (text.length < 2) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

function normalizePreferences(raw: unknown): {
  salaryMin: number | null
  salaryCurrency: string | null
  workMode: string | null
  location: string | null
  technologies: string[]
  stages: string[]
} {
  const p = (raw ?? {}) as Record<string, unknown>
  const salaryMin = toAmount(
    p.salaryMin ?? p.minSalary ?? p.salary_min ?? p.compensationMin ?? p.salary,
  )
  const currency = p.salaryCurrency ?? p.currency ?? p.salary_currency
  const location = p.location ?? p.city ?? p.based ?? p.region

  return {
    salaryMin,
    salaryCurrency:
      typeof currency === 'string' && currency.trim().length > 0
        ? currency.trim().toUpperCase().slice(0, 8)
        : salaryMin !== null
          ? 'EUR'
          : null,
    workMode: normalizeWorkMode(p.workMode ?? p.work_mode ?? p.remote ?? p.arrangement),
    location:
      typeof location === 'string' && location.trim().length > 1 ? location.trim().slice(0, 80) : null,
    technologies: normalizeList(p.technologies ?? p.tech ?? p.tools ?? p.skills ?? p.domains),
    stages: normalizeList(p.stages ?? p.stage ?? p.companyStage ?? p.companySize, 6),
  }
}

export const interpretIntentOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    return { ...obj, preferences: normalizePreferences(obj.preferences) }
  },
  z.object({
    groups: z
      .array(
        z.object({
          label: intentLabelSchema,
          values: z.array(z.string().min(1).max(120)).min(1).max(6),
        }),
      )
      .max(9),
    listeningFor: z.array(z.string().min(1).max(60)).max(8),
    // Only ever what the candidate actually said. Everything here is
    // nullable because an empty field is honest and an invented one is not.
    preferences: z.object({
      salaryMin: z.number().nullable(),
      salaryCurrency: z.string().nullable(),
      workMode: z.string().nullable(),
      location: z.string().nullable(),
      technologies: z.array(z.string()),
      stages: z.array(z.string()),
    }),
  }),
)

export type InterpretIntentOutput = z.infer<typeof interpretIntentOutputSchema>

const EPISTEMIC_RULES = `
Epistemic rules (never violate):
- SOURCE_FACT: a statement about the world, a company, a team, a product or a number that the document asserts. It does not establish what the candidate personally did.
- USER_CLAIM: a statement about the candidate's own actions, ownership or outcomes as asserted by the document.
- "The company had a 45,000-person community" is a SOURCE_FACT. "The candidate grew that community" is a USER_CLAIM only if the document says the candidate did it.
- If ownership, scope or impact is ambiguous, keep the claim conservative and set requiresConfirmation = true.
- Every claim MUST quote a verbatim sourceExcerpt from the provided content. Never invent excerpts.
- confidence expresses how directly the text supports the statement. It is not truth.`

export function runExtractClaimsTask(params: {
  candidateId: string
  sourceName: string
  sourceType: string
  content: string
}) {
  const system = `You are Amble's claim extraction engine, version 1. You read professional source documents and extract discrete professional claims with strict provenance.
${EPISTEMIC_RULES}
Claim types: "experience" (a role, employment or responsibility), "project" (a named project, product or repository), "metric" (a number or measurable outcome), "skill" (an asserted ability), "education", "other".
One claim per distinct professional fact. Do NOT split a single fact across several claims: a role with three responsibilities is one claim about the role plus, at most, a claim for each responsibility that carries its own evidence. Never emit near-duplicates that differ only in wording.
Aim for 15-40 claims. A four-page CV that yields more than 45 is being shredded, not read. Return an empty claims array ONLY if the document truly contains no professional content.
Use EXACTLY these field names for every claim: "statement" (string), "claimType" (one of experience|project|metric|skill|education|other), "epistemicState" (SOURCE_FACT|USER_CLAIM), "sourceExcerpt" (verbatim quote from the content), "confidence" (number 0-1), "requiresConfirmation" (boolean), "possibleCapabilities" (string array, short snake_case suggestions).
Respond ONLY with JSON: {"candidateName": string|null, "claims": [...]}`
  const user = `Source: ${params.sourceName} (type: ${params.sourceType})

Extract every professional claim from the content below.

CONTENT:
${params.content.slice(0, 60_000)}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'extract_professional_claims',
    version: 'v1',
    system,
    user,
    schema: extractClaimsOutputSchema,
    temperature: 0.1,
    // Mechanical extraction over a large document. Thinking here is slow and buys nothing.
    reasoningEffort: 'low',
  })
}

export interface EvidenceForAssessment {
  id: string
  statement: string
  epistemicState: string
  sourceType: string
  sourceExcerpt: string | null
  candidateConfirmed: boolean
}

export function runAssessCapabilitiesTask(params: {
  candidateId: string
  evidence: EvidenceForAssessment[]
}) {
  const system = `You are Amble's capability assessment engine, version 1. You receive EVIDENCE objects — never raw documents — and must determine what professional capabilities the evidence currently demonstrates.

Rules:
- Every capability you emit MUST link to at least one evidence ID you were given. A capability without evidence is forbidden.
- Assessment levels: STRONG_EVIDENCE (multiple independent, corroborating evidence items), GOOD_EVIDENCE (several consistent items), SOME_EVIDENCE (a few items, narrow scope), LIMITED_EVIDENCE (essentially one weak or indirect item), CONTRADICTORY_EVIDENCE (evidence conflicts).
- NEVER inflate: company-level facts do not prove personal ownership. A SOURCE_FACT about an employer supports capability claims only where the text explicitly connects the candidate.
- Emit at most 8 capabilities. Quality over quantity. Merge near-duplicates into the broader one: "analytics" and "performance measurement" are one capability, not two.
- For each capability, include AT MOST 2 uncertainties, and only genuinely material ones: things the evidence cannot yet establish (scope, ownership, scale, depth, recency). Set materiality HIGH when it materially changes how a company should read the capability.
- reason must explain what the evidence shows, referencing its nature (e.g. "two independent sources describe...").
- Respond ONLY with JSON: {"capabilities": [...]}.`
  const user = `EVIDENCE (${params.evidence.length} items):

${JSON.stringify(
  params.evidence.map((e) => ({
    id: e.id,
    statement: e.statement,
    epistemicState: e.epistemicState,
    sourceType: e.sourceType,
    sourceExcerpt: e.sourceExcerpt,
    candidateConfirmed: e.candidateConfirmed,
  })),
  null,
  1,
)}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'assess_capabilities',
    version: 'v1',
    system,
    user,
    schema: assessCapabilitiesOutputSchema,
    temperature: 0.2,
    // Weighing what evidence does and does not prove. The core judgement call.
    reasoningEffort: 'high',
  })
}

export function runReassessAfterAnswerTask(params: {
  candidateId: string
  affectedCapabilities: {
    id: string
    name: string
    assessment: string
    reason: string
    evidenceIds: string[]
  }[]
  evidence: EvidenceForAssessment[]
  openUncertainties: { id: string; capabilityId: string | null; description: string; materiality: string }[]
  question: string
  answer: string
}) {
  const system = `You are Amble's reassessment engine, version 1. The candidate just answered an interview question. New USER_CLAIM evidence has been created from their answer and is included in the evidence list.

Your job:
1. Reassess ONLY the listed capabilities using ALL their evidence (old and new). Same rules as initial assessment: every capability must link evidence IDs; never inflate ownership; company facts are not personal evidence.
2. For each listed open uncertainty, decide its new status: RESOLVED (the answer materially settles it), OPEN (still unknown), or ACCEPTED_UNKNOWN (it will not be resolvable and is not worth pursuing). Only reference uncertainty IDs you were given.
3. Optionally add up to 3 genuinely important new uncertainties discovered from the answer. Use EXACTLY these field names for each: "description" (string), "materiality" (HIGH|MEDIUM|LOW), "capabilitySlug" (string or null).
Respond ONLY with JSON: {"assessments": [...], "uncertaintyUpdates": [...], "newUncertainties": [...]}.`
  const user = `QUESTION ASKED: ${params.question}

CANDIDATE ANSWER: ${params.answer}

CAPABILITIES TO REASSESS:
${JSON.stringify(params.affectedCapabilities, null, 1)}

ALL EVIDENCE FOR THESE CAPABILITIES (including new USER_CLAIM items):
${JSON.stringify(
  params.evidence.map((e) => ({
    id: e.id,
    statement: e.statement,
    epistemicState: e.epistemicState,
    sourceType: e.sourceType,
    sourceExcerpt: e.sourceExcerpt,
    candidateConfirmed: e.candidateConfirmed,
  })),
  null,
  1,
)}

OPEN UNCERTAINTIES:
${JSON.stringify(params.openUncertainties, null, 1)}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'reassess_after_answer',
    version: 'v1',
    system,
    user,
    schema: reassessOutputSchema,
    temperature: 0.2,
    reasoningEffort: 'high',
  })
}

export function runPlanNextQuestionTask(params: {
  candidateId: string
  capabilities: { id: string; name: string; assessment: string; reason: string; uncertaintyIds: string[] }[]
  uncertainties: { id: string; capabilityId: string | null; description: string; materiality: string }[]
  resolvedUncertaintyIds: string[]
  recentTurns: { question: string; answer: string }[]
  questionsAsked: number
  minimumTarget: number
  alreadyAsked: string[]
  questionsRemaining: number
}) {
  const system = `You are Amble's interview strategist, version 1. Your single goal: choose the ONE next question that most improves the accuracy of this professional representation — or declare STOP.

Rules:
- Only ask about genuine uncertainty. NEVER ask what the evidence already establishes.
- NEVER revisit a subject you have already asked about. A question is a repeat if a reasonable person would answer it with "I already told you that" — rephrasing the same subject, narrowing it, or asking for a number you were already refused all count. Read ALREADY ASKED before choosing, and pick different ground.
- You have a limited number of questions left. Spend them on different subjects, not on perfecting one.
- The question must be SHORT and FOCUSED: one single question, maximum 40 words, plain sentences. Never multi-part checklists ("give me X, Y and Z"). Pick the single most valuable unknown.
- Good questions resolve ownership, scope, scale, depth or contradictions, referencing one specific thing the Rep already knows ("You launched X at Y — what part was actually yours?").
- Bad questions are generic ("tell me about your experience"), redundant, or laundry lists.
- action STOP only when remaining open uncertainties are not material enough to justify the candidate's time.
- reason: max 2 sentences.
${writeFor(params.candidateId)}
- Respond ONLY with JSON: {"action": "ASK"|"STOP", "question": string|null, "reason": string, "targetCapabilityIds": [], "targetUncertaintyIds": []}.`
  const user = `QUESTIONS ASKED SO FAR: ${params.questionsAsked}
QUESTIONS REMAINING: ${params.questionsRemaining} — this is a short interview, not an interrogation.
MINIMUM USEFUL INTERVIEW TARGET: ${params.minimumTarget} questions before stopping, unless remaining uncertainty is genuinely immaterial.

ALREADY ASKED (never ask any of these again, in any rewording):
${params.alreadyAsked.map((question, index) => `${index + 1}. ${question}`).join('\n') || '(nothing yet)'}

CAPABILITIES AND CURRENT ASSESSMENTS:
${JSON.stringify(params.capabilities, null, 1)}

OPEN UNCERTAINTIES:
${JSON.stringify(params.uncertainties, null, 1)}

ALREADY RESOLVED UNCERTAINTIES (do not re-ask): ${JSON.stringify(params.resolvedUncertaintyIds)}

RECENT CONVERSATION:
${params.recentTurns.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n\n') || '(none yet)'}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'plan_next_interview_question',
    version: 'v1',
    system,
    user,
    schema: planNextQuestionOutputSchema,
    temperature: 0.3,
    reasoningEffort: 'high',
  })
}

export function runExtractAnswerClaimsTask(params: {
  candidateId: string
  question: string
  questionReason: string
  answer: string
}) {
  const system = `You are Amble's answer extraction engine, version 1. The candidate answered an interview question in their own words. Extract discrete professional claims from their answer.

Rules:
- Everything the candidate asserts about themselves is USER_CLAIM (they said it directly; it is their claim, not a verified fact).
- If they assert something about a company, team or product (not about themselves), extract it as SOURCE_FACT.
- Every claim MUST include sourceExcerpt: a verbatim quote from the ANSWER text supporting the statement. Never invent quotes. If no verbatim quote exists, set sourceExcerpt to null.
- Prefer small precise claims. Do not editorialize or upgrade language ("I helped with X" must not become "owned X").
- Use EXACTLY these field names: "statement" (string), "claimType" (experience|project|metric|skill|education|other), "epistemicState" (SOURCE_FACT|USER_CLAIM), "sourceExcerpt" (string or null), "confidence" (number 0-1, required), "requiresConfirmation" (boolean), "possibleCapabilities" (string array).
- Respond ONLY with JSON: {"claims": [...]}.`
  const user = `INTERVIEW QUESTION: ${params.question}
WHY IT WAS ASKED: ${params.questionReason}

CANDIDATE ANSWER:
${params.answer}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'extract_answer_claims',
    version: 'v1',
    system,
    user,
    schema: answerClaimsOutputSchema,
    temperature: 0.1,
    reasoningEffort: 'low',
  })
}

/**
 * The same extraction, for something nobody asked for.
 *
 * A separate task rather than a flag on the other one, because the prompt
 * that works for an answer lies here: there was no question, and a model
 * told there was will invent the one it thinks it is reading — which is how
 * a sentence about a hobby becomes a claim about a job.
 *
 * The rules are deliberately the same, including the verbatim quote. An
 * unprompted line is *less* checked than an answer, not more, so the one
 * thing holding it to the ground matters more here than anywhere.
 */
export function runExtractUnpromptedClaimsTask(params: {
  candidateId: string
  message: string
}) {
  const system = `You are Amble's unprompted extraction engine, version 1. The candidate wrote to their Rep on their own, with no question in front of them. Extract discrete professional claims from what they wrote.

Rules:
- NOTHING WAS ASKED. Do not infer a question, and do not treat the message as a reply to anything.
- Most such messages contain nothing extractable — chatter, thanks, a question of their own. Returning {"claims": []} is the correct answer far more often than not. Never reach for a claim to have one.
- Everything the candidate asserts about themselves is USER_CLAIM (they said it directly; it is their claim, not a verified fact).
- If they assert something about a company, team or product (not about themselves), extract it as SOURCE_FACT.
- A preference, a constraint or a change of mind about what they want ("I'd move for the right thing now", "no more on-call") IS a claim worth extracting, claimType "other".
- A question they ask is not a claim. An instruction to you is not a claim.
- Every claim MUST include sourceExcerpt: a verbatim quote from the MESSAGE supporting the statement. Never invent quotes. If no verbatim quote exists, set sourceExcerpt to null.
- Prefer small precise claims. Do not editorialize or upgrade language ("I helped with X" must not become "owned X").
- Use EXACTLY these field names: "statement" (string), "claimType" (experience|project|metric|skill|education|other), "epistemicState" (SOURCE_FACT|USER_CLAIM), "sourceExcerpt" (string or null), "confidence" (number 0-1, required), "requiresConfirmation" (boolean), "possibleCapabilities" (string array).
- Respond ONLY with JSON: {"claims": [...]}.`
  const user = `WHAT THEY WROTE, UNPROMPTED:
${params.message}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'extract_unprompted_claims',
    version: 'v1',
    system,
    user,
    schema: answerClaimsOutputSchema,
    temperature: 0.1,
    reasoningEffort: 'low',
  })
}

/**
 * Contestar cuando le preguntan.
 *
 * Hasta ahora el Rep solo hablaba cuando el pipeline producía algo, y a un
 * mensaje suyo respondía «apuntado». Preguntarle algo y que te archive es lo
 * que hace que esto se lea como un formulario con conversación encima.
 *
 * La disciplina es la misma que en todo lo demás, un piso más arriba. Sobre
 * él, solo lo que sostenga el grafo — y el grafo va entero en el prompt,
 * así que lo que no esté ahí no existe. Sobre el mercado, nada: el Rep ha
 * visto las ofertas que ha visto y ninguna más, y «el sector está pagando
 * más» es un horóscopo con confianza.
 *
 * Y lo que no sabe se dice. Un asesor que nunca dice «eso no lo sé de ti» no
 * está asesorando, está completando frases.
 */
export function runAnswerCandidateQuestionTask(params: {
  candidateId: string
  question: string
  language: string
  profile: string
  /** Lo que ya se le dijo antes, para no repetirlo ni contradecirlo. */
  history: string
  /** Lo que sigue en pie entre los dos: consejos y compromisos abiertos. */
  open: string
}) {
  const system = `You are Amble's Rep, answering the candidate directly, version 1. You are their representative and their career advisor: you know them from the profile below and nothing else.

Rules:
- Answer in ${params.language === 'en' ? 'English' : 'Spanish (castellano)'}, in the second person, the way a sharp friend who happens to know their CV would in a chat message.
- ONLY assert things about the candidate that the PROFILE supports. You may reason and advise, but every claim about what they have done or are good at must come from it.
- You have seen the opportunities listed and NO OTHERS. Never describe the market, salary norms, what "companies are looking for" or what is in demand. You do not know.
- Say what you do not know about them when it is what the question turns on. "I do not know whether you have run a team that size" is a better answer than a confident guess.
- Advice must rest on something: a gap in what is known about them, a requirement that came up in the opportunities listed, or something they told you. Advice that rests on nothing is a horoscope — leave it out.
- Do not ask more than one question back, and only if you genuinely cannot answer without it.
- Your answer is a list of "points". EVERY point is one or two sentences and MUST cite at least one real id: an evidence id, an uncertainty id from WHAT IS NOT KNOWN, or an opportunity id from the list. A point that cites nothing is dropped before they ever see it, so do not write one.
- Put the ids ONLY in the id fields. Never write an id inside the text: they are plumbing, and a career conversation with "unc_60a5d2" in the middle of it reads like a database error.
- Short. This is a chat message, not a report: at most 4 points, one or two sentences each, no headings and no bullet markers.
- PLAIN LANGUAGE, and this is not a style note. The profile below is written for an analyst and in English: it says things like STRONG_EVIDENCE, USER_CLAIM, "analytical depth and methods are not evidenced". NEVER echo that wording. Say what it means to the person it is about, in their language, the way you would say it out loud to a friend.
- Concretely: no "evidence", "evidenced", "attribution", "epistemic", "rubric", "at the level of", "corroborated", "scope", "signal". Say "no sé", "no me consta", "no lo veo por ningún lado", "no sé qué parte fue tuya".
- One idea per sentence. If a sentence needs a colon and two commas to hold itself up, it is two sentences.
- Bad: "tu analítica está a nivel de responsabilidad, sin métodos ni experimentación demostrados, y los números de Asgard los das sin atribución clara entre tú y el equipo."
- Good: "De analítica sé que la llevabas, pero no cómo medías ni qué probaste. Y de los números de Asgard no sé qué parte hiciste tú y qué parte el equipo."
- A sentence over 30 words is too long. Cut it.
- "askBack" is the single question back, or null. It asserts nothing, so it needs no citation.
- If nothing you would say can be traced to the profile, return an empty list of points. Saying "I cannot answer that with what I know about you" is a better answer than a paragraph built on nothing.
- Never invent an opportunity, a company, a number or a date.
- "remember" is what should outlast this message: advice you gave that they could act on, and anything they committed to doing. At most 3, and usually 0 or 1. Each one MUST cite at least one id from WHAT IS NOT KNOWN or from the opportunities listed — advice that cites nothing is a horoscope and is not worth remembering. side is "rep" for something you advised, "candidate" for something they said they would do.
- Do not put pleasantries, restatements of the question or generic encouragement in "remember". If nothing in this exchange is worth holding on to, return an empty list.
- Respond ONLY with JSON: {"points": [{"text": string, "evidenceIds": [string], "uncertaintyIds": [string], "opportunityIds": [string]}], "askBack": string|null, "unknowns": [string], "remember": [{"side": "rep"|"candidate", "text": string, "uncertaintyIds": [string], "opportunityIds": [string]}]} where unknowns names what you would need to know to answer better (at most 2, may be empty).`

  const user = `THEIR QUESTION:
${params.question}

WHAT YOU KNOW ABOUT THEM:
${params.profile}

WHAT IS STILL OPEN BETWEEN YOU (advice you gave, things they said they would do):
${params.open || '(nothing yet)'}

WHAT YOU HAVE ALREADY TOLD THEM:
${params.history || '(nothing yet)'}`

  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'answer_candidate_question',
    // v4: lo mismo, dicho de forma que se entienda. El grafo esta escrito
    // para un analista y en ingles, y el modelo lo repetia tal cual.
    version: 'v4',
    system,
    user,
    schema: candidateAnswerOutputSchema,
    temperature: 0.3,
    reasoningEffort: 'medium',
  })
}

export function runDistinctiveProfileTask(params: {
  candidateId: string
  capabilities: { id: string; name: string; assessment: string; reason: string }[]
}) {
  const system = `You are Amble's distinctive-profile engine, version 1. From the candidate's demonstrated capabilities, identify up to 3 that form an unusually defining INTERSECTION — a combination that is harder to have together than either alone.

Rules:
- You may ONLY reference capability IDs from the provided list.
- Only use capabilities with STRONG_EVIDENCE or GOOD_EVIDENCE.
- If fewer than 2 qualifying capabilities exist, return an empty list. Do not manufacture distinctiveness.
- Respond ONLY with JSON: {"capabilityIds": ["...", ...]}.`
  const user = `CAPABILITIES:
${JSON.stringify(params.capabilities, null, 1)}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'distinctive_profile',
    version: 'v1',
    system,
    user,
    schema: distinctiveProfileOutputSchema,
    temperature: 0.2,
    reasoningEffort: 'medium',
  })
}

export function runDescriptorTask(params: {
  candidateId: string
  capabilities: { name: string; assessment: string }[]
  candidateName: string | null
}) {
  const system = `You are Amble's profile summary engine, version 1. Write one short professional descriptor of the candidate, grounded ONLY in the listed capabilities.

Rules:
- Maximum 12 words. No titles you weren't given. No superlatives. No adjectives about personality.
- It must be true if all the listed capabilities are true, and imply nothing more.
- Example shape: "Marketing, growth and community around technology."
${writeFor(params.candidateId)}
- Respond ONLY with JSON: {"descriptor": string}.`
  const user = `CANDIDATE: ${params.candidateName ?? '(name unknown)'}
CAPABILITIES:
${JSON.stringify(params.capabilities, null, 1)}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'summarize_profile',
    version: 'v1',
    system,
    user,
    schema: descriptorOutputSchema,
    temperature: 0.2,
    reasoningEffort: 'low',
  })
}

export function runInterpretIntentTask(params: { candidateId: string; answer: string }) {
  const system = `You are Amble's intent interpretation engine, version 2. The candidate described what would make a professional opportunity worth considering. Structure what they said WITHOUT adding anything they didn't say.

Rules:
- Only use these labels: "Role", "Space", "Company", "Compensation", "Ownership", "Location", "Not interested in", "Other".
- Values must be short items (1-6 words) faithfully derived from the answer. Never invent values, numbers or ranges they didn't state.
- If they didn't mention compensation, do not create a Compensation group.
- listeningFor: up to 8 short phrases summarizing what to listen for, strictly from the answer.
- preferences: the same answer reduced to what could be checked against a real job posting. Use null, or an empty array, for anything they did not state. NEVER guess a number.
  - salaryMin: annual gross as a number, no currency symbol, no range. The bottom of a range if they gave one.
  - salaryCurrency: ISO code, e.g. "EUR".
  - workMode: exactly one of "onsite", "hybrid", "remote".
  - location: the place they want to work from or near.
  - technologies: tools, stacks, domains or kinds of product they named.
  - stages: company stages or sizes they named, e.g. "seed", "scale-up", "large company".
${writeFor(params.candidateId)}
- Respond ONLY with JSON: {"groups": [{"label": ..., "values": [...]}], "listeningFor": [...], "preferences": {"salaryMin": ..., "salaryCurrency": ..., "workMode": ..., "location": ..., "technologies": [...], "stages": [...]}}.`
  const user = `CANDIDATE ANSWER:
${params.answer}`
  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'interpret_intent',
    version: 'v2',
    system,
    user,
    schema: interpretIntentOutputSchema,
    temperature: 0.2,
    reasoningEffort: 'medium',
  })
}
