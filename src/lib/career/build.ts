import {
  getCareerDocument,
  getOrCreateCandidate,
  insertCareerDocument,
  listCapabilities,
  listCareerDocumentVersions,
  listEvidence,
  listRetractions,
  listSources,
  listUncertainties,
} from '../db/repo'
import { reconcileCapabilities, syncAttributionUncertainties } from '../pipeline/graph'
import { candidateLocale, serverText } from '../i18n/candidate'
import { renderCareerMarkdown, type RenderedCareer, type RenderStats } from './render'
import { runSynthesizeCareerTask, type EvidenceForSynthesis } from './synthesis'

export class NoEvidenceError extends Error {
  constructor() {
    super(serverText().noEvidence)
    this.name = 'NoEvidenceError'
  }
}

const MAX_EVIDENCE_IN_PROMPT = 160

function toSynthesisInput(candidateId: string): EvidenceForSynthesis[] {
  return listEvidence(candidateId)
    .slice(0, MAX_EVIDENCE_IN_PROMPT)
    .map((row) => ({
      id: row.id,
      statement: row.statement,
      epistemicState: row.epistemic_state,
      sourceType: row.source_type,
      sourceExcerpt: row.source_excerpt ? row.source_excerpt.slice(0, 240) : null,
      strength: row.strength,
      candidateConfirmed: row.candidate_confirmed === 1,
    }))
}

export interface CareerBuildResult extends RenderedCareer {
  modelRunId: string
  version: number
  createdAt: string
}

export async function buildCareerMarkdown(): Promise<CareerBuildResult> {
  const candidate = getOrCreateCandidate()
  const evidence = listEvidence(candidate.id)
  if (evidence.length === 0) throw new NoEvidenceError()

  // Deterministic, no model call: levels assessed before attribution existed
  // must not reach the file above the assisted ceiling.
  reconcileCapabilities(candidate.id)
  syncAttributionUncertainties(candidate.id)

  const capabilities = listCapabilities(candidate.id).map((row) => ({
    name: row.name,
    assessment: row.assessment,
    reason: row.reason,
  }))

  const { data, modelRunId } = await runSynthesizeCareerTask({
    candidateId: candidate.id,
    candidateName: candidate.name,
    evidence: toSynthesisInput(candidate.id),
    capabilities,
  })

  const rendered = renderCareerMarkdown({
    profile: data,
    candidate,
    evidence,
    sources: listSources(candidate.id),
    uncertainties: listUncertainties(candidate.id),
    retractions: listRetractions(candidate.id),
    locale: candidateLocale(),
  })

  const document = insertCareerDocument({
    candidateId: candidate.id,
    markdown: rendered.markdown,
    stats: rendered.stats,
    modelRunId,
  })

  return { ...rendered, modelRunId, version: document.version, createdAt: document.created_at }
}

export interface StoredCareer {
  version: number
  markdown: string
  stats: RenderStats
  modelRunId: string | null
  createdAt: string
}

export function getStoredCareer(version?: number): StoredCareer | null {
  const candidate = getOrCreateCandidate()
  const row = getCareerDocument(candidate.id, version)
  if (!row) return null
  return {
    version: row.version,
    markdown: row.markdown,
    stats: JSON.parse(row.stats) as RenderStats,
    modelRunId: row.model_run_id,
    createdAt: row.created_at,
  }
}

export function listStoredCareerVersions() {
  const candidate = getOrCreateCandidate()
  return listCareerDocumentVersions(candidate.id).map((row) => ({
    version: row.version,
    stats: JSON.parse(row.stats) as RenderStats,
    modelRunId: row.model_run_id,
    createdAt: row.created_at,
  }))
}
