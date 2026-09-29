import { listCapabilities, listClaims, listUnprocessedSources } from '../db/repo'
import { assessCapabilities, buildDescriptor, buildDistinctiveProfile, claimsToEvidence } from './graph'
import { prepareSetupQuestions } from './interview'
import { processSource, SourceRejectedError } from './sources'

// Reading what someone shared, in the background, while they tell the Rep
// what they are looking for. Their sources are read at the same time, then
// what they show is weighed into capabilities; the two setup questions are
// planned from those, and the profile's summary is written last, as nothing
// waits for it. The page only looks at how far it has got.

export type SetupStage = 'reading' | 'weighing' | 'questions' | 'done' | 'failed'

export interface SetupProgress {
  stage: SetupStage
  sources: number
  read: number
  // What was found so far, as it comes: statements, then capabilities.
  found: string[]
  capabilities: { name: string; assessment: string }[]
  rejected: { name: string; reason: string }[]
  error: string | null
  startedAt: number
}

declare global {
  var __ambleSetups: Map<string, SetupProgress> | undefined
}
// On globalThis: the route that starts it and the one that asks are separate bundles.
const setups = (globalThis.__ambleSetups ??= new Map())

export function setupProgress(candidateId: string): SetupProgress | null {
  return setups.get(candidateId) ?? null
}

const FOUND_SHOWN = 8

// Starts it once; a second call while it runs, or after it is done, only
// reports. After a failure it can be started again, from where it stopped.
export function startSetup(candidateId: string): SetupProgress {
  const running = setups.get(candidateId)
  const pending = listUnprocessedSources(candidateId)
  // Running: it only reports. Done, with nothing new shared since: the same.
  if (running && running.stage !== 'failed' && (running.stage !== 'done' || pending.length === 0)) return running
  // Nothing they shared could be used, and nothing new since: it stays so.
  if (running?.error === 'nothing_extracted' && pending.length === 0) return running
  const progress: SetupProgress = {
    stage: 'reading',
    sources: pending.length,
    read: 0,
    found: [],
    capabilities: [],
    rejected: [],
    error: null,
    startedAt: Date.now(),
  }
  setups.set(candidateId, progress)
  void run(candidateId, progress)
  return progress
}

async function run(candidateId: string, progress: SetupProgress): Promise<void> {
  try {
    const pending = listUnprocessedSources(candidateId)
    // Every source at once: each is one long model call. All of them finish
    // before any failure counts, so none is still being read if it restarts.
    const results = await Promise.allSettled(
      pending.map(async (source) => {
        try {
          const result = await processSource(source, candidateId)
          progress.found.push(...result.discoveries.map((discovery) => discovery.title))
          progress.found = progress.found.slice(0, FOUND_SHOWN)
        } catch (error) {
          if (error instanceof SourceRejectedError) progress.rejected.push({ name: error.sourceName, reason: error.reason })
          else throw error
        } finally {
          progress.read++
        }
      }),
    )
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
    if (listClaims(candidateId).length === 0) throw new Error('nothing_extracted')

    progress.stage = 'weighing'
    claimsToEvidence(candidateId)
    await assessCapabilities(candidateId)
    progress.capabilities = listCapabilities(candidateId).map((capability) => ({ name: capability.name, assessment: capability.assessment }))

    progress.stage = 'questions'
    await prepareSetupQuestions(candidateId)
    progress.stage = 'done'

    // Now that it knows what they can do, the first read for offers can start
    // (it waits for this), if they already said what they are looking for.
    void import('../matching/run').then(({ startFirstRead }) => startFirstRead(candidateId)).catch(() => undefined)

    // The map's summary: after, with nobody waiting for it.
    await buildDistinctiveProfile(candidateId).catch(() => undefined)
    await buildDescriptor(candidateId).catch(() => undefined)
  } catch (error) {
    progress.stage = 'failed'
    progress.error = error instanceof Error ? error.message : String(error)
    console.error('[setup] failed for', candidateId, progress.error)
  }
}
