import type { CandidateRow, EvidenceRow, RetractionRow, SourceRow, UncertaintyRow } from '../db/repo'
import { isUnverifiedAssisted } from '../pipeline/attribution'
import { dictionaries, type Dictionary } from '../i18n/dictionaries'
import type { Locale } from '../i18n/locale'
import type { CareerProfileOutput, GroundedStatement } from './synthesis'

// Deterministic rendering. The model proposes structure; this module decides what
// survives. A statement whose evidence IDs do not resolve is dropped, not softened:
// provenance is enforced here rather than requested in a prompt.

export interface RenderStats {
  statementsKept: number
  statementsDropped: number
  assistedStatements: number
  completeness: number
}

export interface RenderedCareer {
  markdown: string
  stats: RenderStats
}

interface ResolvedStatement {
  text: string
  tags: string[]
  assisted: boolean
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function resolve(
  statement: GroundedStatement,
  evidenceById: Map<string, EvidenceRow>,
  sourceTags: Record<string, string>,
): ResolvedStatement | null {
  const resolved = statement.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((row): row is EvidenceRow => row !== undefined)

  // Domain rule: no provenance, no statement.
  if (resolved.length === 0) return null

  const tags = [...new Set(resolved.map((row) => sourceTags[row.source_type] ?? row.source_type))].sort()
  // Any undefended assisted support flags the statement. A majority rule would
  // let a trivially true fact (the repo exists) launder the claim beside it.
  return { text: statement.text, tags, assisted: resolved.some(isUnverifiedAssisted) }
}

function line(statement: ResolvedStatement, c: Dictionary['career']): string {
  const tags = statement.tags.map((tag) => `\`[${tag}]\``).join('')
  const assisted = statement.assisted ? c.assistedFlag : ''
  return `${statement.text} ${tags}${assisted}`
}

function computeCompleteness(
  profile: CareerProfileOutput,
  kept: number,
  openUncertainties: number,
): number {
  const sections = [
    profile.headline.length > 0,
    profile.howIWork.length > 0,
    profile.trajectory.length > 0,
    profile.education.length > 0,
    profile.shipped.length > 0,
  ]
  const filled = sections.filter(Boolean).length / sections.length
  const grounded = kept === 0 ? 0 : Math.min(1, kept / 25)
  const resolved = openUncertainties === 0 ? 1 : Math.max(0, 1 - openUncertainties / 12)
  return Math.round(((filled * 0.4 + grounded * 0.4 + resolved * 0.2) + Number.EPSILON) * 100) / 100
}

export function renderCareerMarkdown(params: {
  profile: CareerProfileOutput
  candidate: CandidateRow
  evidence: EvidenceRow[]
  sources: SourceRow[]
  uncertainties: UncertaintyRow[]
  retractions: RetractionRow[]
  locale: Locale
  generatedAt?: Date
}): RenderedCareer {
  const { profile, candidate, evidence, sources, uncertainties, retractions } = params
  const c = dictionaries[params.locale].career
  const evidenceById = new Map(evidence.map((row) => [row.id, row]))
  const generatedAt = (params.generatedAt ?? new Date()).toISOString().slice(0, 10)

  let kept = 0
  let dropped = 0
  let assisted = 0

  const take = (statement: GroundedStatement): ResolvedStatement | null => {
    const resolved = resolve(statement, evidenceById, c.tags)
    if (!resolved) {
      dropped++
      return null
    }
    kept++
    if (resolved.assisted) assisted++
    return resolved
  }

  const oneLiner = profile.oneLiner.text.length >= 3 ? take(profile.oneLiner) : null
  const howIWork = profile.howIWork.map(take).filter((s): s is ResolvedStatement => s !== null)

  const trajectory = profile.trajectory.map((entry) => ({
    ...entry,
    bullets: entry.bullets.map(take).filter((s): s is ResolvedStatement => s !== null),
  }))

  const education = profile.education.filter((entry) => {
    const hasProvenance = entry.evidenceIds.some((id) => evidenceById.has(id))
    if (!hasProvenance) dropped++
    else kept++
    return hasProvenance
  })

  const shipped = profile.shipped
    .map((entry) => {
      const description = take(entry.description)
      return description ? { name: entry.name, description } : null
    })
    .filter((entry): entry is { name: string; description: ResolvedStatement } => entry !== null)

  const contradictions = profile.contradictions
    .map((entry) => {
      const sides = entry.sides.map(take).filter((s): s is ResolvedStatement => s !== null)
      return sides.length >= 2 ? { ...entry, sides } : null
    })
    .filter((entry) => entry !== null)

  const openUncertainties = uncertainties.filter((u) => u.status === 'OPEN')
  const completeness = computeCompleteness(profile, kept, openUncertainties.length)

  const out: string[] = []

  out.push('---')
  out.push(c.header1)
  out.push(c.header2)
  out.push('schema: career.md/0.1')
  out.push('generated_by: amble')
  out.push(`generated_at: ${generatedAt}`)
  out.push(`name: ${yamlString(candidate.name ?? c.noName)}`)
  if (profile.headline) out.push(`headline: ${yamlString(profile.headline)}`)
  out.push(`headline_alt: ${c.headlineAlt}`)
  out.push(`completeness: ${completeness}`)
  out.push('sources:')
  for (const source of sources) {
    out.push(`  - { type: ${source.type}, name: ${yamlString(source.name)}, status: ${source.status} }`)
  }
  out.push('evidence:')
  out.push(`  statements_kept: ${kept}`)
  out.push(`  statements_dropped_without_provenance: ${dropped}`)
  out.push(`  statements_assisted_undefended: ${assisted}`)
  out.push(`  open_uncertainties: ${openUncertainties.length}`)
  out.push(`  retracted: ${retractions.length}`)
  out.push('---')
  out.push('')
  out.push(`# ${candidate.name ?? c.profileFallback}`)
  out.push('')
  out.push(c.provenance)
  out.push(c.assistedNote)
  out.push('')

  if (oneLiner) {
    out.push(c.oneLine)
    out.push('')
    out.push(line(oneLiner, c))
    out.push('')
  }

  if (howIWork.length > 0) {
    out.push(c.howIWork)
    out.push('')
    for (const statement of howIWork) out.push(`- ${line(statement, c)}`)
    out.push('')
  }

  if (trajectory.length > 0) {
    out.push(c.trajectory)
    out.push('')
    for (const entry of trajectory) {
      const heading = [entry.organisation, entry.role].filter(Boolean).join(' — ')
      out.push(`### ${heading}${entry.period ? ` · ${entry.period}` : ''}`)
      out.push('')
      if (entry.bullets.length === 0) {
        out.push(c.noStatementsForStage)
      } else {
        for (const bullet of entry.bullets) out.push(`- ${line(bullet, c)}`)
      }
      out.push('')
    }
  }

  if (education.length > 0) {
    out.push(c.education)
    out.push('')
    out.push(c.educationHeader)
    out.push('| --- | --- | --- |')
    for (const entry of education) {
      out.push(`| ${entry.title} | ${entry.institution ?? '—'} | ${entry.date ?? '—'} |`)
    }
    out.push('')
  }

  if (shipped.length > 0) {
    out.push(c.shipped)
    out.push('')
    for (const entry of shipped) out.push(`- **${entry.name}** — ${line(entry.description, c)}`)
    out.push('')
  }

  if (contradictions.length > 0) {
    out.push(c.contradictions)
    out.push('')
    for (const entry of contradictions) {
      out.push(`### ${entry.title}`)
      out.push('')
      for (const side of entry.sides) out.push(`- ${line(side, c)}`)
      if (entry.reading) {
        out.push('')
        out.push(c.reading(entry.reading))
      }
      out.push('')
    }
  }

  if (openUncertainties.length > 0) {
    out.push(c.openGaps)
    out.push('')
    out.push(c.gapsHeader)
    out.push('| --- | --- | --- |')
    for (const uncertainty of openUncertainties.slice(0, 20)) {
      const kind = uncertainty.kind === 'ATTRIBUTION' ? c.kindAttribution : c.kindMateriality
      out.push(`| ${uncertainty.description} | ${kind} | ${uncertainty.materiality} |`)
    }
    out.push('')
  }

  // PRODUCT_SPEC §12.1: what the system believed, and why it stopped believing it.
  if (retractions.length > 0) {
    out.push(c.retracted)
    out.push('')
    out.push(c.retractedNote)
    out.push('')
    for (const retraction of retractions) {
      out.push(`- ⊘ ~~${retraction.statement}~~`)
      if (retraction.question) out.push(c.question(retraction.question))
      if (retraction.answer) out.push(`  - Respuesta: ${retraction.answer.replace(/\s+/g, ' ').slice(0, 300)}`)
      out.push(c.reason(retraction.reason))
    }
    out.push('')
  }

  if (dropped > 0) {
    out.push('---')
    out.push('')
    out.push(c.dropped(dropped))
    out.push('')
  }

  return {
    markdown: out.join('\n'),
    stats: { statementsKept: kept, statementsDropped: dropped, assistedStatements: assisted, completeness },
  }
}
