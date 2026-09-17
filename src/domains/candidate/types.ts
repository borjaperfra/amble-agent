export type EpistemicState =
  | 'source_fact'
  | 'user_claim'
  | 'inference'
  | 'verified_fact'
  | 'system_assessment'

export type SourceType =
  | 'cv'
  | 'github'
  | 'linkedin'
  | 'website'
  | 'interview'
  | 'verified'

export type EvidenceStrength =
  | 'strong'
  | 'good'
  | 'some'
  | 'limited'
  | 'none'
  | 'contradictory'

export const strengthLabel: Record<EvidenceStrength, string> = {
  strong: 'Strong evidence',
  good: 'Good evidence',
  some: 'Some evidence',
  limited: 'Limited evidence',
  none: 'No evidence yet',
  contradictory: 'Contradictory evidence',
}

export const strengthLevel: Record<EvidenceStrength, number> = {
  strong: 4,
  good: 3,
  some: 2,
  limited: 1,
  none: 0,
  contradictory: 2,
}

export const sourceTypeLabel: Record<string, string> = {
  cv: 'CV',
  github: 'GitHub',
  linkedin: 'LinkedIn',
  website: 'Website',
  interview: 'Interview',
  verified: 'Verified',
}

export interface Source {
  id: string
  type: SourceType
  label: string
  action: string
  identifier: string | null
  connected: boolean
  prominent?: boolean
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

export interface EvidenceGap {
  id: string
  name: string
  explanation: string
  options: string[]
}

export interface InterviewQuestion {
  id: string
  context: string
  question: string
  why: string
  fixtureTranscript: string
}

export interface IntentGroup {
  id: string
  label: string
  values: string[]
}

export type ProcessingStep =
  | { kind: 'status' | 'activity' | 'summary' | 'count'; text: string }
  | { kind: 'discovery'; title: string; meta: string; source: string }
