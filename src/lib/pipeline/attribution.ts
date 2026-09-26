import type { EvidenceRow } from '../db/repo'

// Pure attribution rules (PRODUCT_SPEC §11.1). No database, no model: the
// renderer depends on these and must stay runnable on fixtures alone.

// Sources whose content is routinely authored by the candidate together with a
// tool. From 2026 this is the normal case for code repositories.
export const ASSISTED_SOURCE_TYPES = new Set(['github'])

export function isUnverifiedAssisted(evidence: Pick<EvidenceRow, 'epistemic_state' | 'defence_status'>): boolean {
  return evidence.epistemic_state === 'ASSISTED_CLAIM' && evidence.defence_status !== 'defended'
}
