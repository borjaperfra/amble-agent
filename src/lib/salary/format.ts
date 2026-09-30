// How an estimate reads, on the screen and on WhatsApp. No database here: the
// client imports it.

// "28–33K": the table's figures, in thousands.
export function estimateRange(estimate: { min: number; max: number }): string {
  const k = (n: number) => `${Math.round(n / 100) / 10}`
  return estimate.min === estimate.max ? `${k(estimate.min)}K` : `${k(estimate.min)}–${k(estimate.max)}K`
}

export interface EstimateWords {
  label: string
  places: Record<'madrid' | 'barcelona' | 'valencia' | 'spain' | 'bilbao' | 'sevilla', string>
  experience: (text: string) => string
}

// "Estimado: 28–33K · Hays 2026, Community manager (2-5 años), Madrid": the
// figure is never shown without saying it is an estimate and whose.
export function estimateLine(
  estimate: { min: number; max: number; source: string; year: number; role: string; experience: string; place: keyof EstimateWords['places'] },
  words: EstimateWords,
): string {
  return `${words.label}: ${estimateRange(estimate)} · ${estimateSource(estimate, words)}`
}

export function estimateSource(
  estimate: { source: string; year: number; role: string; experience: string; place: keyof EstimateWords['places'] },
  words: EstimateWords,
): string {
  return `${estimate.source} ${estimate.year}, ${estimate.role} (${words.experience(estimate.experience)}), ${words.places[estimate.place]}`
}
