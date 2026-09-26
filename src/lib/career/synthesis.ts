import { z } from 'zod'
import { runStructuredTask } from '../model/provider'

// The model proposes the STRUCTURE of a career.md. It never writes the file.
// Rendering is deterministic (render.ts) so that provenance can be enforced
// rather than requested: a statement without resolvable evidence is dropped.

interface RawStatementShape {
  text?: unknown
  statement?: unknown
  evidenceIds?: unknown
  evidence?: unknown
}

export interface GroundedStatement {
  text: string
  evidenceIds: string[]
}

function normalizeStatement(raw: unknown): GroundedStatement | null {
  if (typeof raw === 'string') {
    return raw.trim().length >= 3 ? { text: raw.trim().slice(0, 400), evidenceIds: [] } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const s = raw as RawStatementShape
  const text = typeof s.text === 'string' ? s.text : typeof s.statement === 'string' ? s.statement : null
  if (!text || text.trim().length < 3) return null
  const rawIds = Array.isArray(s.evidenceIds) ? s.evidenceIds : Array.isArray(s.evidence) ? s.evidence : []
  return {
    text: text.trim().slice(0, 400),
    evidenceIds: rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 12),
  }
}

function normalizeStatements(raw: unknown, max: number): GroundedStatement[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeStatement)
    .filter((item): item is GroundedStatement => item !== null)
    .slice(0, max)
}

function asString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null
}

function asIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 12)
    : []
}

const statementSchema = z.object({
  text: z.string().min(3).max(400),
  evidenceIds: z.array(z.string().min(1)).max(12),
})

export const careerProfileOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

    return {
      headline: asString(obj.headline, 140) ?? '',
      oneLiner: normalizeStatement(obj.oneLiner) ?? { text: '', evidenceIds: [] },
      howIWork: normalizeStatements(obj.howIWork, 10),

      trajectory: list(obj.trajectory)
        .map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>
          const organisation = asString(e.organisation ?? e.organization ?? e.company, 80)
          if (!organisation) return null
          return {
            organisation,
            role: asString(e.role ?? e.title, 100),
            period: asString(e.period ?? e.dates, 60),
            bullets: normalizeStatements(e.bullets ?? e.points, 10),
          }
        })
        .filter((entry) => entry !== null)
        .slice(0, 12),

      education: list(obj.education)
        .map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>
          const title = asString(e.title ?? e.qualification, 120)
          if (!title) return null
          return {
            title,
            institution: asString(e.institution ?? e.school, 120),
            date: asString(e.date ?? e.period, 60),
            evidenceIds: asIds(e.evidenceIds),
          }
        })
        .filter((entry) => entry !== null)
        .slice(0, 8),

      shipped: list(obj.shipped)
        .map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>
          const name = asString(e.name ?? e.title, 100)
          const description = normalizeStatement(e.description ?? e.summary)
          if (!name || !description) return null
          return { name, description }
        })
        .filter((entry) => entry !== null)
        .slice(0, 8),

      contradictions: list(obj.contradictions)
        .map((entry) => {
          const e = (entry ?? {}) as Record<string, unknown>
          const title = asString(e.title, 160)
          const sides = normalizeStatements(e.sides ?? e.statements, 6)
          if (!title || sides.length < 2) return null
          return { title, sides, reading: asString(e.reading, 600) }
        })
        .filter((entry) => entry !== null)
        .slice(0, 4),
    }
  },
  z.object({
    headline: z.string().max(140),
    oneLiner: z.object({ text: z.string().max(400), evidenceIds: z.array(z.string()).max(12) }),
    howIWork: z.array(statementSchema).max(10),
    trajectory: z
      .array(
        z.object({
          organisation: z.string().min(1).max(80),
          role: z.string().max(100).nullable(),
          period: z.string().max(60).nullable(),
          bullets: z.array(statementSchema).max(10),
        }),
      )
      .max(12),
    education: z
      .array(
        z.object({
          title: z.string().min(1).max(120),
          institution: z.string().max(120).nullable(),
          date: z.string().max(60).nullable(),
          evidenceIds: z.array(z.string()).max(12),
        }),
      )
      .max(8),
    shipped: z
      .array(z.object({ name: z.string().min(1).max(100), description: statementSchema }))
      .max(8),
    contradictions: z
      .array(
        z.object({
          title: z.string().min(1).max(160),
          sides: z.array(statementSchema).min(2).max(6),
          reading: z.string().max(600).nullable(),
        }),
      )
      .max(4),
  }),
)

export type CareerProfileOutput = z.infer<typeof careerProfileOutputSchema>

export interface EvidenceForSynthesis {
  id: string
  statement: string
  epistemicState: string
  sourceType: string
  sourceExcerpt: string | null
  strength: string
  candidateConfirmed: boolean
}

const SYSTEM_PROMPT = `You are Amble's career.md synthesis engine, version 1. You turn a candidate's evidence graph into the STRUCTURE of their career.md. You do not write the file; a deterministic renderer does that.

The iron rule: EVERY statement you write must carry the evidenceIds it came from. A statement whose evidenceIds are empty or unresolvable is DISCARDED by the renderer and never reaches the candidate. Never write a sentence you cannot ground.

Rules:
- You may ONLY cite evidence IDs from the provided list. Never invent an ID.
- Write in a plain specific register. No marketing adjectives, no superlatives.
- Write in the FIRST PERSON throughout, consistently. This is the candidate's own document, in their voice: "Lidero marketing y comunidad", never "Lidera marketing" or "Su método consiste en". Never refer to the candidate by name or in the third person anywhere, in any section.
- A number is only as current as the source it came from. When evidence gives a figure, state it; never round it up, never present a stale figure as today's.
- Never add a fact, number, date, title, employer or skill that is not in the evidence.
- Prefer few strong statements to many weak ones. An empty section is correct when evidence is thin.
- headline: one line, max 140 characters, true if all cited evidence is true, implying nothing more.
- howIWork: how this person works, drawn from evidence about behaviour and method, not personality adjectives.
- trajectory: one entry per organisation, most recent first. Bullets carry numbers only where the evidence carries numbers.
- shipped: things the candidate actually built or launched.
- contradictions: only where two pieces of evidence genuinely disagree. Cite both sides. "reading" is your interpretation and may be null. Never manufacture a contradiction.
- Respond ONLY with JSON of this shape: {"headline": string, "oneLiner": {"text": string, "evidenceIds": [string]}, "howIWork": [{"text": string, "evidenceIds": [string]}], "trajectory": [{"organisation": string, "role": string|null, "period": string|null, "bullets": [{"text": string, "evidenceIds": [string]}]}], "education": [{"title": string, "institution": string|null, "date": string|null, "evidenceIds": [string]}], "shipped": [{"name": string, "description": {"text": string, "evidenceIds": [string]}}], "contradictions": [{"title": string, "sides": [{"text": string, "evidenceIds": [string]}], "reading": string|null}]}.`

export function runSynthesizeCareerTask(params: {
  candidateId: string
  candidateName: string | null
  evidence: EvidenceForSynthesis[]
  capabilities: { name: string; assessment: string; reason: string }[]
}) {
  const user = `CANDIDATE: ${params.candidateName ?? '(name unknown)'}

CAPABILITIES:
${JSON.stringify(params.capabilities, null, 1)}

EVIDENCE (cite these IDs and no others):
${JSON.stringify(params.evidence, null, 1)}`

  return runStructuredTask({
    candidateId: params.candidateId,
    task: 'synthesize_career_md',
    version: 'v1',
    system: SYSTEM_PROMPT,
    user,
    schema: careerProfileOutputSchema,
    temperature: 0.25,
  })
}
