import { z } from 'zod'
import { inTransaction } from '../db/db'
import {
  answerOfferProbe,
  decideRevealedPreference,
  getLatestIntent,
  getLatestOfferTriage,
  getOfferProbe,
  getOfferTriage,
  candidateById,
  getRevealedPreference,
  insertCandidatePreference,
  insertOfferTriage,
  listCapabilities,
  listCapabilityEvidenceIds,
  listClaims,
  listEvidence,
  listOfferProbes,
  listRevealedPreferences,
  parseJsonArray,
  replaceProposedPreferences,
  reviseRevealedPreference,
  updateOfferTriageStatus,
  type OfferProbeRow,
  type OfferTriageRow,
  type RevealedPreferenceRow,
} from '../db/repo'
import { runStructuredTask } from '../model/provider'
import { isUnverifiedAssisted } from './attribution'
import { serverText } from '../i18n/candidate'

// Revealed intent (PRODUCT_SPEC §15.1). What someone declares they want is
// written from what they believe they value; what they reject is produced by
// what they will not tolerate. Only the second is measurable. A triage makes it
// measurable: every offer crosses two or more declared conditions, so each
// answer is a trade-off, not a comfortable preference.

export const VERDICTS = ['yes', 'yes_if', 'depends', 'no'] as const
export type Verdict = (typeof VERDICTS)[number]

export const PREFERENCE_KINDS = ['hard_filter', 'strong', 'weak', 'neutral', 'compensation', 'self_filter'] as const
export type PreferenceKind = (typeof PREFERENCE_KINDS)[number]

export class TriageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'TriageError'
  }
}

export const probeInputSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(1000),
  salaryEur: z.number().int().positive().nullable(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  axes: z.array(z.string().min(1).max(120)).max(8).default([]),
  isStatusQuo: z.boolean().default(false),
})

export type ProbeInput = z.infer<typeof probeInputSchema>

export const createTriageInputSchema = z
  .object({
    method: z.string().max(1000).nullable().default(null),
    declared: z.string().max(4000).nullable().default(null),
    probes: z.array(probeInputSchema).min(4).max(12),
  })
  .superRefine((value, ctx) => {
    // Without the status quo there is no baseline and every answer is measured
    // in a vacuum. Without crossed axes an offer tests a preference, not a trade-off.
    if (value.probes.filter((probe) => probe.isStatusQuo).length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'A triage needs exactly one status-quo offer.', path: ['probes'] })
    }
    value.probes.forEach((probe, idx) => {
      if (!probe.isStatusQuo && probe.axes.length < 2) {
        ctx.addIssue({ code: 'custom', message: 'Every offer must cross at least two axes.', path: ['probes', idx, 'axes'] })
      }
    })
  })

export type CreateTriageInput = z.infer<typeof createTriageInputSchema>

function declaredSnapshot(candidateId: string): string | null {
  const intent = getLatestIntent(candidateId)
  if (!intent) return null
  return `En sus palabras: ${intent.raw_answer}\nInterpretado: ${intent.groups}`
}

export function createTriage(candidateId: string, input: CreateTriageInput): OfferTriageRow {
  const candidate = candidateById(candidateId)
  return insertOfferTriage({
    candidateId: candidate.id,
    method: input.method,
    declared: input.declared ?? declaredSnapshot(candidate.id),
    probes: input.probes,
  })
}

// ── Generation ───────────────────────────────────────────────────────────

const GENERATE_SYSTEM_PROMPT = `You are Amble's triage designer, version 1.

You design a set of job offers that measure what a candidate will actually trade, as opposed to what they say they want. The candidate will answer each offer with yes / yes if / depends / no and a reason.

Design rules:
- 8 offers. Exactly ONE is the status quo: staying in their current job, described plainly from the evidence. Set "isStatusQuo": true on it and "axes": ["statu quo"].
- Every other offer crosses AT LEAST TWO of the candidate's declared conditions against each other, so saying yes costs something they claim to want. Never design an offer that is simply good or simply bad.
- "axes" names the conditions each offer tests (2 to 4 short labels). The candidate will NOT see them.
- Cover, across the set: money, location / office days, stage, team and budget, autonomy, language or time zone, and the technical ceiling of the role. Test each declared condition at least twice, from different sides.
- If CONFIRMED or REJECTED revealed preferences exist from an earlier triage, do not re-test what is settled. Aim offers at what is still uncertain, especially rejected proposals.
- Things marked as inferred by the system are hypotheses: test them.
- Realistic offers for this person's field and seniority. Salaries in EUR, anchored on the candidate's declared floor and current compensation when known, spread roughly from 30% below to 70% above the floor. Never invent a current salary: if unknown, the status quo "salaryEur" is null.
- "title": role · company type (invented, no real company names). "description": 1 to 3 short sentences with the concrete conditions. No marketing language.
- "attributes": the structured conditions, e.g. {"remote": "full"|"hybrid"|"onsite", "onsite_days": 3, "location": "...", "stage": "...", "team": 4, "budget_eur": 300000, "equity_pct": 1, "language": "en", "timezone": "...", "autonomy": "...", "technical_demand": "..."}.

Respond ONLY with JSON: {"probes": [{"title": string, "description": string, "salaryEur": number|null, "attributes": object, "axes": string[], "isStatusQuo": boolean}]}.`

const generatedProbesSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const list = Array.isArray(obj.probes) ? obj.probes : []
    return {
      probes: list.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>
        const salary = typeof e.salaryEur === 'number' && Number.isFinite(e.salaryEur) ? Math.round(e.salaryEur) : null
        return {
          title: typeof e.title === 'string' ? e.title.trim().slice(0, 200) : '',
          description: typeof e.description === 'string' ? e.description.trim().slice(0, 1000) : '',
          salaryEur: salary !== null && salary > 0 ? salary : null,
          attributes: e.attributes && typeof e.attributes === 'object' && !Array.isArray(e.attributes) ? e.attributes : {},
          axes: Array.isArray(e.axes) ? e.axes.filter((axis): axis is string => typeof axis === 'string').slice(0, 8) : [],
          isStatusQuo: e.isStatusQuo === true,
        }
      }),
    }
  },
  z.object({ probes: z.array(probeInputSchema) }),
)

export async function generateTriage(candidateId: string): Promise<OfferTriageRow> {
  const candidate = candidateById(candidateId)
  const latest = getLatestOfferTriage(candidate.id)
  if (latest && latest.status === 'open') {
    // Two open triages would split the answers and the baseline between them.
    throw new TriageError(serverText().triageOpen, 409)
  }

  const declared = declaredSnapshot(candidate.id) ?? latest?.declared ?? null
  const experience = listClaims(candidate.id)
    .filter((claim) => claim.claim_type === 'experience')
    .slice(0, 40)
    .map((claim) => claim.statement)
  const capabilities = listCapabilities(candidate.id)
    .filter((capability) => capability.assessment !== 'NO_EVIDENCE_YET')
    .map((capability) => ({ name: capability.name, assessment: capability.assessment }))
  const earlier = latest
    ? listRevealedPreferences(latest.id)
        .filter((row) => row.status !== 'proposed')
        .map((row) => ({ kind: row.kind, statement: row.statement, status: row.status }))
    : []

  const user = `DECLARED INTENT:\n${declared ?? '(nothing declared yet: test the conditions implied by the evidence)'}\n\nCURRENT AND PAST EXPERIENCE:\n${experience.map((line) => `- ${line}`).join('\n') || '(none)'}\n\nCAPABILITIES:\n${JSON.stringify(capabilities, null, 1)}\n\nREVEALED PREFERENCES FROM THE PREVIOUS TRIAGE:\n${earlier.length > 0 ? JSON.stringify(earlier, null, 1) : '(none)'}`

  // The shape is checked by the same rules as a hand-built triage. One retry,
  // with the violations fed back, before giving up.
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, modelRunId } = await runStructuredTask({
      candidateId: candidate.id,
      task: 'generate_offer_triage',
      version: 'v1',
      system: GENERATE_SYSTEM_PROMPT,
      user: user + feedback,
      schema: generatedProbesSchema,
      temperature: 0.6,
    })
    const parsed = createTriageInputSchema.safeParse({
      method: `Diseñado por amble (model run ${modelRunId}). El candidato no ve qué eje prueba cada oferta.`,
      declared,
      probes: data.probes,
    })
    if (parsed.success) return createTriage(candidate.id, parsed.data)
    feedback = `\n\nYOUR PREVIOUS DESIGN WAS INVALID. Fix exactly these problems:\n${parsed.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`
  }
  throw new TriageError(serverText().triageDesignFailed, 502)
}

// ── Views ────────────────────────────────────────────────────────────────

export interface ProbeView {
  id: string
  number: number
  title: string
  description: string
  salaryEur: number | null
  isStatusQuo: boolean
  verdict: Verdict | null
  conditions: string | null
  reason: string | null
  // Hidden until the triage is analysed: if the candidate sees what an offer
  // tests, they answer the test instead of the offer.
  axes?: string[]
  attributes?: Record<string, unknown>
}

export interface PreferenceView {
  id: string
  kind: PreferenceKind
  statement: string
  declared: string | null
  evidenceProbeNumbers: number[]
  quote: string | null
  status: 'proposed' | 'confirmed' | 'rejected'
  addedByYou: boolean
  // What the analysis had proposed, when the candidate corrected it.
  originalStatement: string | null
  // A self-filter is surfaced for discussion. It never becomes a listening rule
  // on its own: if the agent inherits it, it discards offers the candidate
  // would win, invisibly.
  neverInheritSilently: boolean
}

export interface TriageView {
  id: string
  status: string
  method: string | null
  declared: string | null
  createdAt: string
  analysedAt: string | null
  probes: ProbeView[]
  preferences: PreferenceView[]
}

function probeView(probe: OfferProbeRow, reveal: boolean): ProbeView {
  const view: ProbeView = {
    id: probe.id,
    number: probe.idx + 1,
    title: probe.title,
    description: probe.description,
    salaryEur: probe.salary_eur,
    isStatusQuo: probe.is_status_quo === 1,
    verdict: probe.verdict as Verdict | null,
    conditions: probe.conditions,
    reason: probe.reason,
  }
  if (reveal) {
    view.axes = parseJsonArray(probe.axes)
    view.attributes = JSON.parse(probe.attributes) as Record<string, unknown>
  }
  return view
}

function preferenceView(row: RevealedPreferenceRow, numberById: Map<string, number>): PreferenceView {
  return {
    id: row.id,
    kind: row.kind as PreferenceKind,
    statement: row.statement,
    declared: row.declared,
    evidenceProbeNumbers: parseJsonArray(row.evidence_probe_ids)
      .map((id) => numberById.get(id))
      .filter((n): n is number => n !== undefined),
    quote: row.quote,
    status: row.status as PreferenceView['status'],
    addedByYou: row.origin === 'candidate',
    originalStatement: row.original_statement,
    neverInheritSilently: row.kind === 'self_filter',
  }
}

export function getTriageView(candidateId: string, triageId?: string): TriageView | null {
  const candidate = candidateById(candidateId)
  const triage = triageId ? getOfferTriage(triageId) : getLatestOfferTriage(candidate.id)
  if (!triage || triage.candidate_id !== candidate.id) return null
  const probes = listOfferProbes(triage.id)
  const reveal = triage.status === 'analysed'
  const numberById = new Map(probes.map((probe) => [probe.id, probe.idx + 1]))
  return {
    id: triage.id,
    status: triage.status,
    method: triage.method,
    declared: triage.declared,
    createdAt: triage.created_at,
    analysedAt: triage.analysed_at,
    probes: probes.map((probe) => probeView(probe, reveal)),
    preferences: listRevealedPreferences(triage.id).map((row) => preferenceView(row, numberById)),
  }
}

// ── Answering ────────────────────────────────────────────────────────────

export function answerProbe(
  candidateId: string,
  params: {
    probeId: string
    verdict: string
    conditions?: string | null
    reason?: string | null
  },
): void {
  const probe = getOfferProbe(params.probeId)
  const triage = probe ? getOfferTriage(probe.triage_id) : undefined
  if (!probe || !triage || triage.candidate_id !== candidateId) throw new TriageError(serverText().offerNotFound, 404)
  if (triage.status === 'analysed') {
    throw new TriageError(serverText().triageFrozen, 409)
  }
  if (!VERDICTS.includes(params.verdict as Verdict)) {
    throw new TriageError(`verdict must be one of: ${VERDICTS.join(', ')}.`)
  }
  const conditions = params.conditions?.trim() || null
  if (params.verdict === 'yes_if' && !conditions) {
    throw new TriageError(serverText().conditionRequired)
  }
  // The literal reason is stored exactly as given: it is the evidence.
  answerOfferProbe(probe.id, params.verdict, conditions, params.reason?.trim() || null)
}

// ── Analysis ─────────────────────────────────────────────────────────────

const analysisOutputSchema = z.preprocess(
  (raw) => {
    const obj = (raw ?? {}) as Record<string, unknown>
    const list = Array.isArray(obj.preferences) ? obj.preferences : []
    return {
      preferences: list.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>
        return {
          kind: typeof e.kind === 'string' ? e.kind.toLowerCase().trim() : '',
          statement: typeof e.statement === 'string' ? e.statement.trim().slice(0, 500) : '',
          label: typeof e.label === 'string' && e.label.trim() ? e.label.trim().slice(0, 60) : null,
          declared: typeof e.declared === 'string' && e.declared.trim() ? e.declared.trim().slice(0, 300) : null,
          offers: Array.isArray(e.offers) ? e.offers.filter((n): n is number => typeof n === 'number') : [],
          quote: typeof e.quote === 'string' && e.quote.trim() ? e.quote.trim().slice(0, 300) : null,
        }
      }),
    }
  },
  z.object({
    preferences: z
      .array(
        z.object({
          kind: z.string(),
          statement: z.string(),
          label: z.string().nullable(),
          declared: z.string().nullable(),
          offers: z.array(z.number()),
          quote: z.string().nullable(),
        }),
      )
      .max(16),
  }),
)

const ANALYSIS_SYSTEM_PROMPT = `You are Amble's revealed-intent analyst, version 4.

The candidate answered a set of job offers. Each offer deliberately crossed two or more of their declared conditions, so every answer was a trade-off. Their literal reasons are the evidence. Your job is to state what their answers REVEAL, and where that differs from what they DECLARED.

Kinds:
- "hard_filter": kills an offer on its own, at any price. Needs at least one rejection where the rest of the offer was attractive.
- "strong": decides between offers once hard filters pass.
- "weak": something declared (or inferred by the system) that did not decide anything when it was on the table. Set "declared" to what was claimed.
- "neutral": a condition one would expect to matter that the answers show does not.
- "compensation": what money actually does: the floor their yeses reveal, what equity is worth to them, the premium an unwanted condition would cost. Use only the figures in the offers and in their words.
- "self_filter": a rejection whose stated reason is contradicted by the candidate's own professional evidence (e.g. "I don't have that level" for a job they already do). Only when the CAPABILITIES list supports the contradiction.

Causal rules — these are where analyses go wrong:
- Attribute a verdict to a factor only if the literal reason names that factor, or if comparing two offers isolates it. A factor that was present in a rejected offer but NOT mentioned in its reason is evidence AGAINST that factor being decisive.
- "depends" is not decisive. It cannot on its own support a hard_filter or a strong preference.
- Never attribute to money what another crossed axis explains. If the high-salary offers also carried a rejected condition (location, office days, a skill gap), say what money did NOT buy given that condition, not that money stops mattering.
- Value equity as the gap between what they asked for on the equity offer and their lowest unconditional yes. State the figure.
- Anything marked "inferred by the system" is a hypothesis under test, not a preference. Keep it only if the evidence is decisive; otherwise report it as "weak" with "declared" set to the inference, and say plainly that it was not confirmed.
- A rejection whose reason is a real gap supported by the evidence (the role requires a skill the candidate does not have) is a hard_filter, not a self_filter.
- Capabilities with "attributed": false rest on work co-produced with an AI tool that the candidate has not defended. They must NOT be used to contradict a stated technical gap.

Rules:
- Every preference cites "offers": the offer numbers that show it. No offer, no preference.
- "quote": optional. If present, it must be copied VERBATIM from the candidate's reason or condition for one of the cited offers. Never paraphrase inside a quote.
- The status-quo offer is the baseline; use it.
- A "no" with a literal reason defines a boundary; a "yes" only confirms. Weigh them accordingly.
- Do not restate each answer. Find the few things that change how an agent should filter offers for this person. 4 to 10 preferences.
- "label": the preference as it stands now, in at most 6 words, written as the candidate would write it on a list of their conditions (e.g. "Minimum salary: 75K", "Remote, or 1–2 days in Valencia", "Writing or reviewing code", "Offers in English"). A plain fact, never the story of how it was found: no "real", "actual", "declared", "unconfirmed", no "not X" correcting an earlier figure, no comparison with what they said before. That story belongs in the statement. Same language as the statement, which is the output language.
- Write statements in second person, plain.

Respond ONLY with JSON: {"preferences": [{"kind": string, "statement": string, "label": string, "declared": string|null, "offers": number[], "quote": string|null}]}.`

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[“”«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Deterministic signals, so the model reads money off the data instead of
// estimating it.
function compensationSignals(probes: OfferProbeRow[]) {
  const by = (verdict: Verdict) =>
    probes
      .filter((probe) => probe.verdict === verdict && probe.salary_eur !== null)
      .map((probe) => ({ offer: probe.idx + 1, salaryEur: probe.salary_eur }))
  const unconditionalYes = by('yes').map((entry) => entry.salaryEur as number)
  return {
    yes: by('yes'),
    yesIf: by('yes_if'),
    depends: by('depends'),
    no: by('no'),
    lowestUnconditionalYes: unconditionalYes.length > 0 ? Math.min(...unconditionalYes) : null,
  }
}

export interface AnalysisResult {
  kept: number
  dropped: { statement: string; reason: string }[]
  quotesRemoved: number
}

export async function analyseTriage(candidateId: string, triageId?: string): Promise<AnalysisResult> {
  const candidate = candidateById(candidateId)
  const triage = triageId ? getOfferTriage(triageId) : getLatestOfferTriage(candidate.id)
  if (!triage || triage.candidate_id !== candidate.id) throw new TriageError(serverText().noTriage, 404)

  const probes = listOfferProbes(triage.id)
  const unanswered = probes.filter((probe) => probe.verdict === null)
  if (unanswered.length > 0) {
    throw new TriageError(
      serverText().offersUnanswered(unanswered.map((probe) => probe.idx + 1)),
      409,
    )
  }

  // A capability resting mostly on undefended co-produced work cannot be used to
  // tell the candidate they underrate themselves: it is exactly the evidence
  // that fails in the flattering direction (PRODUCT_SPEC §11.1).
  const evidenceById = new Map(listEvidence(candidate.id).map((item) => [item.id, item]))
  const links = listCapabilityEvidenceIds(candidate.id)
  const capabilities = listCapabilities(candidate.id)
    .filter((capability) => capability.assessment !== 'NO_EVIDENCE_YET')
    .map((capability) => {
      const linked = (links.get(capability.id) ?? []).map((id) => evidenceById.get(id)).filter((item) => item !== undefined)
      const unverified = linked.filter(isUnverifiedAssisted).length
      return {
        name: capability.name,
        assessment: capability.assessment,
        attributed: !(linked.length > 0 && unverified * 2 > linked.length),
      }
    })

  const offers = probes.map((probe) => ({
    offer: probe.idx + 1,
    title: probe.title,
    description: probe.description,
    salaryEur: probe.salary_eur,
    statusQuo: probe.is_status_quo === 1,
    attributes: JSON.parse(probe.attributes) as Record<string, unknown>,
    axesCrossed: parseJsonArray(probe.axes),
    verdict: probe.verdict,
    condition: probe.conditions,
    reason: probe.reason,
  }))

  const { data, modelRunId } = await runStructuredTask({
    candidateId: candidate.id,
    task: 'analyse_offer_triage',
    version: 'v4',
    system: ANALYSIS_SYSTEM_PROMPT,
    user: `DECLARED BEFORE THE TRIAGE:\n${triage.declared ?? '(nothing on record)'}\n\nCAPABILITIES (from the evidence graph):\n${JSON.stringify(capabilities, null, 1)}\n\nCOMPENSATION SIGNALS (computed):\n${JSON.stringify(compensationSignals(probes), null, 1)}\n\nOFFERS AND ANSWERS:\n${JSON.stringify(offers, null, 1)}`,
    schema: analysisOutputSchema,
    temperature: 0.2,
  })

  // Domain rules. The model proposes; these decide what is stored.
  const probeByNumber = new Map(probes.map((probe) => [probe.idx + 1, probe]))
  const dropped: AnalysisResult['dropped'] = []
  let quotesRemoved = 0
  const rows: Parameters<typeof replaceProposedPreferences>[1] = []

  for (const proposal of data.preferences) {
    if (!PREFERENCE_KINDS.includes(proposal.kind as PreferenceKind)) {
      dropped.push({ statement: proposal.statement, reason: `unknown kind "${proposal.kind}"` })
      continue
    }
    if (proposal.statement.length < 10) {
      dropped.push({ statement: proposal.statement, reason: 'empty statement' })
      continue
    }
    const cited = [...new Set(proposal.offers)]
      .map((n) => probeByNumber.get(n))
      .filter((probe): probe is OfferProbeRow => probe !== undefined)
    if (cited.length === 0) {
      dropped.push({ statement: proposal.statement, reason: 'cites no existing offer' })
      continue
    }
    if (proposal.kind === 'hard_filter' && !cited.some((probe) => probe.verdict === 'no')) {
      // A hard filter is a boundary, and only a rejection draws one.
      dropped.push({ statement: proposal.statement, reason: 'hard filter without a rejection behind it' })
      continue
    }
    if (proposal.kind === 'strong' && cited.every((probe) => probe.verdict === 'depends')) {
      dropped.push({ statement: proposal.statement, reason: 'strong preference resting only on "depends"' })
      continue
    }

    let quote = proposal.quote
    if (quote) {
      const needle = normalise(quote)
      const found = cited.some((probe) =>
        [probe.reason, probe.conditions].some((text) => text !== null && normalise(text).includes(needle)),
      )
      if (!found) {
        quote = null
        quotesRemoved++
      }
    }

    rows.push({
      candidate_id: candidate.id,
      triage_id: triage.id,
      kind: proposal.kind,
      statement: proposal.statement,
      label: proposal.label,
      declared: proposal.declared,
      evidence_probe_ids: JSON.stringify(cited.map((probe) => probe.id)),
      quote,
      model_run_id: modelRunId,
    })
  }

  inTransaction(() => {
    replaceProposedPreferences(triage.id, rows)
    updateOfferTriageStatus(triage.id, 'analysed')
  })

  return { kept: rows.length, dropped, quotesRemoved }
}

function ownPreference(candidateId: string, preferenceId: string): RevealedPreferenceRow {
  const candidate = candidateById(candidateId)
  const preference = getRevealedPreference(preferenceId)
  if (!preference || preference.candidate_id !== candidate.id) throw new TriageError(serverText().preferenceNotFound, 404)
  return preference
}

// The candidate's own correction (PRODUCT_SPEC §18). It confirms the preference:
// correcting something means accepting the corrected version.
export function revisePreference(candidateId: string, preferenceId: string, statement: string, label: string | null): void {
  const preference = ownPreference(candidateId, preferenceId)
  const text = statement.trim()
  if (text.length < 10) throw new TriageError(serverText().tooShort)
  reviseRevealedPreference(preference.id, text.slice(0, 500), label?.trim().slice(0, 60) || null)
  if (preference.status !== 'confirmed') decideRevealedPreference(preference.id, 'confirmed')
}

// Something the analysis missed, added by the candidate. It is tied to the
// latest analysed triage and held to the same rules as a proposed preference:
// offers must exist and a quote must be verbatim.
export function addPreference(
  candidateId: string,
  params: {
    kind: string
    statement: string
    label?: string | null
    offerNumbers?: number[]
    quote?: string | null
  },
): RevealedPreferenceRow {
  const candidate = candidateById(candidateId)
  const triage = getLatestOfferTriage(candidate.id)
  if (!triage || triage.status !== 'analysed') throw new TriageError(serverText().noAnalysedTriage, 409)
  if (!PREFERENCE_KINDS.includes(params.kind as PreferenceKind)) {
    throw new TriageError(`kind must be one of: ${PREFERENCE_KINDS.join(', ')}.`)
  }
  const statement = params.statement.trim()
  if (statement.length < 10) throw new TriageError(serverText().tooShort)

  const probes = listOfferProbes(triage.id)
  const cited = [...new Set(params.offerNumbers ?? [])].map((n) => {
    const probe = probes.find((p) => p.idx + 1 === n)
    if (!probe) throw new TriageError(serverText().noSuchOffer(n))
    return probe
  })

  const quote = params.quote?.trim() || null
  if (quote) {
    const needle = normalise(quote)
    const found = cited.some((probe) => [probe.reason, probe.conditions].some((text) => text !== null && normalise(text).includes(needle)))
    if (!found) throw new TriageError(serverText().quoteNotFound)
  }

  return insertCandidatePreference({
    candidateId: candidate.id,
    triageId: triage.id,
    kind: params.kind,
    statement: statement.slice(0, 500),
    label: params.label?.trim().slice(0, 60) || null,
    evidenceProbeIds: cited.map((probe) => probe.id),
    quote,
  })
}

export function decidePreference(candidateId: string, preferenceId: string, decision: string): void {
  const candidate = candidateById(candidateId)
  const preference = getRevealedPreference(preferenceId)
  if (!preference || preference.candidate_id !== candidate.id) throw new TriageError(serverText().preferenceNotFound, 404)
  if (decision !== 'confirmed' && decision !== 'rejected') {
    throw new TriageError('decision must be "confirmed" or "rejected".')
  }
  decideRevealedPreference(preference.id, decision)
}
