// How often something may happen for one key (a number that writes to
// amble), counted in this process: enough to stop a script, with nothing to
// store. A restart forgets the counts, which only ever lets someone through.

declare global {
  var __ambleWhatsAppThrottle: Map<string, number[]> | undefined
}

const seen = (globalThis.__ambleWhatsAppThrottle ??= new Map<string, number[]>())
// Past this many keys, the ones whose times have all gone by are forgotten.
const PRUNE_AT = 5_000

function recent(key: string, windowMs: number, at: number): number[] {
  return (seen.get(key) ?? []).filter((time) => at - time < windowMs)
}

// Whether it may happen now; when it may, it is counted.
export function allow(bucket: string, key: string, limit: number, windowMs: number): boolean {
  const at = Date.now()
  const id = `${bucket}:${key}`
  const times = recent(id, windowMs, at)
  if (times.length >= limit) return false
  times.push(at)
  seen.set(id, times)
  if (seen.size > PRUNE_AT) for (const [other, list] of seen) if (list.every((time) => at - time >= windowMs)) seen.delete(other)
  return true
}

// Whether the limit is reached, without counting anything.
export function exhausted(bucket: string, key: string, limit: number, windowMs: number): boolean {
  return recent(`${bucket}:${key}`, windowMs, Date.now()).length >= limit
}

// Counted without asking: a try that failed.
export function count(bucket: string, key: string, windowMs: number): void {
  const at = Date.now()
  const id = `${bucket}:${key}`
  seen.set(id, [...recent(id, windowMs, at), at])
}

export function forget(bucket: string, key: string): void {
  seen.delete(`${bucket}:${key}`)
}
