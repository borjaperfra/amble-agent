import { getOfferFacts } from '../db/opportunities'
import type { OfferFacts } from './facts'

// How the role is done, as the offer's own words say it, for what a screen
// shows and what the assessor judges by: the board's tag only when the offer's text, read, says nothing. A
// board tagged an OpenAI role as not hybrid whose text asks for three office
// days a week. Null when neither says.
export function workplaceShown(opportunityId: string, boardTag: string | null): string | null {
  const stored = getOfferFacts(opportunityId)
  if (stored) {
    try {
      const facts = JSON.parse(stored.facts) as Partial<OfferFacts>
      if (facts.workplace?.value && facts.workplace.quote) return facts.workplace.value
    } catch {
      // Unreadable facts say nothing: the board's tag stands.
    }
  }
  return boardTag
}

