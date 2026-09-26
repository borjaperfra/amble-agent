export type EvidenceStrength =
  | 'strong'
  | 'good'
  | 'some'
  | 'limited'
  | 'none'
  | 'contradictory'

export const strengthLevel: Record<EvidenceStrength, number> = {
  strong: 4,
  good: 3,
  some: 2,
  limited: 1,
  none: 0,
  contradictory: 2,
}

export interface Evidence {
  id: string
  capabilityId?: string
  claim: string
  sourceType: string
  date?: string | null
  confirmed: boolean
  supports: string
  epistemicState?: string | null
}

export interface Capability {
  id: string
  name: string
  strength: EvidenceStrength
  explanation: string
}

