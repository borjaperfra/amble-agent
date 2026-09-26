// The one shape every source produces. Adapters differ in how they read a
// source; nothing downstream knows which source an offer came from.

export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'workable'
export type SourceKind = AtsKind | 'theirstack'
export type Workplace = 'remote' | 'hybrid' | 'onsite'

export interface RawOpportunity {
  source: SourceKind
  externalId: string
  companyName: string
  companyDomain?: string | null
  title: string
  location: string | null
  workplace: Workplace | null
  url: string | null
  description: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryRaw: string | null
  postedAt: string | null
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly source: SourceKind,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}
