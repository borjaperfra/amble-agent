import type { UncertaintyRow } from '../db/repo'

/**
 * Uncertainties used to be deduplicated by exact string match, so the same
 * question entered the pool several times with different wording and the
 * candidate got asked about it more than once. This compares meaning-ish:
 * shared vocabulary, ignoring the filler that every uncertainty shares.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'that', 'this', 'these',
  'those', 'it', 'its', 'not', 'no', 'whether', 'which', 'what', 'how', 'much', 'his', 'her',
  'their', 'he', 'she', 'they', 'candidate', 'unclear', 'established', 'described', 'provided',
  'evidence', 'about', 'any', 'some', 'only', 'does', 'did', 'do', 'has', 'have', 'had',
  'personally', 'actually', 'still', 'yet', 'whether', 'remains', 'given', 'shown', 'stated',
])

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  )
}

/** Overlap against the smaller set, so a short restatement still counts. */
export function similarity(a: string, b: string): number {
  const left = tokenize(a)
  const right = tokenize(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared++
  return shared / Math.min(left.size, right.size)
}

export const SIMILARITY_THRESHOLD = 0.5

export function isDuplicateUncertainty(
  existing: Pick<UncertaintyRow, 'description' | 'capability_id'>[],
  description: string,
  capabilityId: string | null,
  threshold = SIMILARITY_THRESHOLD,
): boolean {
  return existing.some((item) => {
    if (capabilityId && item.capability_id && item.capability_id !== capabilityId) return false
    return similarity(item.description, description) >= threshold
  })
}
