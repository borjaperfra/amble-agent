import { getDb } from '../db/db'
import { explanationVoice } from '../db/repo'
import { runRewriteExplanationsTask } from '../model/tasks'

// What the person reads on their profile, written before the profile spoke to
// them (in English, about "the candidate", with internal labels, cut at a
// character count), or in a language they no longer use. Rewritten once, in
// the background, when they open their profile; or on demand with
// scripts/rewrite-explanations.ts. Only the wording changes: assessments,
// evidence and links stay as they are.

interface StaleCapability {
  id: string
  name: string
  assessment: string
  reason: string
}

interface StaleUncertainty {
  id: string
  capability_id: string | null
  description: string
}

// Capabilities per model call, with what is unknown about them.
const CHUNK = 12
// After a failure, the next view waits this long before trying again.
const RETRY_AFTER_MS = 10 * 60_000

declare global {
  var __ambleExplanations: { running: Set<string>; failedAt: Map<string, number> } | undefined
}
const state = (globalThis.__ambleExplanations ??= { running: new Set(), failedAt: new Map() })

function stale(candidateId: string, voice: string, force: boolean) {
  const db = getDb()
  const where = force ? '' : 'AND (written_for IS NULL OR written_for != ?)'
  const args = force ? [candidateId] : [candidateId, voice]
  const capabilities = db
    .prepare(`SELECT id, name, assessment, reason FROM capabilities WHERE candidate_id = ? ${where} ORDER BY id`)
    .all(...args) as unknown as StaleCapability[]
  const uncertainties = db
    .prepare(`SELECT id, capability_id, description FROM uncertainties WHERE candidate_id = ? AND status = 'OPEN' ${where} ORDER BY id`)
    .all(...args) as unknown as StaleUncertainty[]
  return { capabilities, uncertainties }
}

export function hasStaleExplanations(candidateId: string): boolean {
  const { capabilities, uncertainties } = stale(candidateId, explanationVoice(candidateId), false)
  return capabilities.length > 0 || uncertainties.length > 0
}

export async function rewriteExplanations(candidateId: string, options: { force?: boolean } = {}): Promise<{ capabilities: number; uncertainties: number }> {
  const voice = explanationVoice(candidateId)
  const { capabilities, uncertainties } = stale(candidateId, voice, options.force ?? false)
  const db = getDb()
  const done = { capabilities: 0, uncertainties: 0 }

  // Each uncertainty travels with its capability; the rest with the last chunk.
  const chunks: { capabilities: StaleCapability[]; uncertainties: StaleUncertainty[] }[] = []
  for (let index = 0; index < capabilities.length; index += CHUNK) {
    const group = capabilities.slice(index, index + CHUNK)
    const ids = new Set(group.map((capability) => capability.id))
    chunks.push({ capabilities: group, uncertainties: uncertainties.filter((u) => u.capability_id && ids.has(u.capability_id)) })
  }
  const placed = new Set(chunks.flatMap((chunk) => chunk.uncertainties.map((u) => u.id)))
  const orphans = uncertainties.filter((u) => !placed.has(u.id))
  if (orphans.length > 0) {
    if (chunks.length === 0) chunks.push({ capabilities: [], uncertainties: [] })
    chunks[chunks.length - 1].uncertainties.push(...orphans)
  }

  // Only a row still holding the text that was sent is replaced: if the
  // interview reassessed it meanwhile, the newer text stands.
  const setCapability = db.prepare(
    'UPDATE capabilities SET name = ?, reason = ?, written_for = ? WHERE candidate_id = ? AND id = ? AND name = ? AND reason = ?',
  )
  const setUncertainty = db.prepare(
    'UPDATE uncertainties SET description = ?, written_for = ? WHERE candidate_id = ? AND id = ? AND description = ?',
  )

  for (const chunk of chunks) {
    const { data } = await runRewriteExplanationsTask({
      candidateId,
      capabilities: chunk.capabilities,
      uncertainties: chunk.uncertainties.map((u) => ({ id: u.id, capabilityId: u.capability_id, description: u.description })),
    })
    const sentCapabilities = new Map(chunk.capabilities.map((capability) => [capability.id, capability]))
    const sentUncertainties = new Map(chunk.uncertainties.map((u) => [u.id, u]))
    for (const rewritten of data.capabilities) {
      const sent = sentCapabilities.get(rewritten.id)
      if (!sent) continue
      sentCapabilities.delete(rewritten.id)
      done.capabilities += Number(setCapability.run(rewritten.name, rewritten.reason, voice, candidateId, sent.id, sent.name, sent.reason).changes)
    }
    for (const rewritten of data.uncertainties) {
      const sent = sentUncertainties.get(rewritten.id)
      if (!sent) continue
      sentUncertainties.delete(rewritten.id)
      done.uncertainties += Number(setUncertainty.run(rewritten.description, voice, candidateId, sent.id, sent.description).changes)
    }
  }
  return done
}

// From the profile page: never waits, never throws, one pass at a time per
// person, and not again soon after a failure.
export function rewriteExplanationsInBackground(candidateId: string): void {
  if (state.running.has(candidateId)) return
  const failedAt = state.failedAt.get(candidateId)
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return
  try {
    if (!hasStaleExplanations(candidateId)) return
  } catch {
    return
  }
  state.running.add(candidateId)
  void rewriteExplanations(candidateId)
    // Whatever the model left out waits for the cooldown too.
    .then(() => (hasStaleExplanations(candidateId) ? state.failedAt.set(candidateId, Date.now()) : state.failedAt.delete(candidateId)))
    .catch((error) => {
      state.failedAt.set(candidateId, Date.now())
      console.error(`[explanations] ${candidateId}:`, error instanceof Error ? error.message : error)
    })
    .finally(() => state.running.delete(candidateId))
}
