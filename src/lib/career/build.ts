import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY } from '../db/db'
import {
  getOrCreateCandidate,
  listCapabilities,
  listEvidence,
  listRetractions,
  listSources,
  listUncertainties,
} from '../db/repo'
import { reconcileCapabilities, syncAttributionUncertainties } from '../pipeline/graph'
import { renderCareerMarkdown, type RenderedCareer } from './render'
import { runSynthesizeCareerTask, type EvidenceForSynthesis } from './synthesis'

export class NoEvidenceError extends Error {
  constructor() {
    super('There is no evidence yet. Add sources and let your Rep read them first.')
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
  storedPath: string
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
  })

  // Written to disk so the generated file can be diffed against the handwritten
  // reference at the repo root, which is the regression target for this task.
  const storedPath = path.join(DATA_DIRECTORY, 'career.md')
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true })
  fs.writeFileSync(storedPath, rendered.markdown, 'utf8')

  return { ...rendered, modelRunId, storedPath }
}
