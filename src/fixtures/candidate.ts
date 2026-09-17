import type {
  Capability,
  Evidence,
  EvidenceGap,
  Source,
} from '@/domains/candidate/types'

export { sourceTypeLabel } from '@/domains/candidate/types'

export const candidate = {
  name: 'Borja Pérez Francés',
  headline: 'Marketing, growth and community around technology.',
  distinctive: ['AI infrastructure', 'Developer communities', 'Brand & growth'],
  updated: 'Last updated today',
}

export const fixtureSources: Source[] = [
  {
    id: 'cv',
    type: 'cv',
    label: 'CV',
    action: 'Add CV',
    identifier: null,
    connected: false,
    prominent: true,
  },
  {
    id: 'github',
    type: 'github',
    label: 'GitHub',
    action: 'Connect',
    identifier: 'borjaperezfrances',
    connected: false,
  },
  {
    id: 'linkedin',
    type: 'linkedin',
    label: 'LinkedIn',
    action: 'Add profile',
    identifier: 'linkedin.com/in/borjaperezfrances',
    connected: false,
  },
  {
    id: 'website',
    type: 'website',
    label: 'Website',
    action: 'Add',
    identifier: 'borjaperez.dev',
    connected: false,
  },
]

export const fixtureExperiences = [
  { id: 'manfred', company: 'Manfred', meta: 'Marketing Manager · 2019 — 2026' },
  { id: 'helmcode', company: 'Helmcode', meta: 'Growth & Marketing · 2026 —' },
]

export const fixtureProjects = [
  { id: 'atskiller', company: 'ATS Killer', meta: 'Open-source ATS analyzer · 40k+ analyses' },
  { id: 'mondaybench', company: 'MondayBench', meta: 'Public AI benchmark' },
]

export const capabilities: Capability[] = [
  {
    id: 'brand-positioning',
    name: 'Brand & positioning',
    strength: 'strong',
    explanation:
      'Repeated ownership of positioning, narrative and product communication across Manfred and Helmcode.',
  },
  {
    id: 'developer-community',
    name: 'Developer community',
    strength: 'strong',
    explanation:
      'Built and led communities of tens of thousands of developers, mostly through community-led motions rather than paid acquisition.',
  },
  {
    id: 'product-marketing',
    name: 'Product marketing',
    strength: 'strong',
    explanation:
      'Launches, messaging and pricing communication for developer-facing products, from Manfred to Helmcode.',
  },
  {
    id: 'go-to-market',
    name: 'Go-to-market',
    strength: 'good',
    explanation:
      'Led GTM for product launches end to end, including pricing, packaging and sequencing decisions.',
  },
  {
    id: 'content-communication',
    name: 'Content & communication',
    strength: 'good',
    explanation:
      'Writes for practitioners, not audiences. Newsletter, talks and engineering-facing communication.',
  },
  {
    id: 'technical-product',
    name: 'Technical product',
    strength: 'some',
    explanation:
      'Created and maintains public technical products. Not an engineer, but comfortably ships and speaks the language.',
  },
  {
    id: 'ecosystem-partnerships',
    name: 'Ecosystem & partnerships',
    strength: 'some',
    explanation:
      'Built partnership programs and organized community events that connected vendors, developers and companies.',
  },
  {
    id: 'team-leadership',
    name: 'Team leadership',
    strength: 'limited',
    explanation:
      'Has managed a small team directly and led through influence. Scope beyond that is not yet clear.',
  },
]

export const evidence: Evidence[] = [
  {
    id: 'ev-01',
    capabilityId: 'brand-positioning',
    claim: 'Defined positioning and narrative for the Helmcode launch.',
    sourceType: 'cv',
    date: '2026',
    confirmed: true,
    supports: 'Directly describes owning how Helmcode explains itself.',
  },
  {
    id: 'ev-02',
    capabilityId: 'brand-positioning',
    claim: "Rebuilt Manfred's employer brand and careers narrative.",
    sourceType: 'cv',
    date: '2021 — 2023',
    confirmed: true,
    supports: 'Multi-year ownership of a brand, not a one-off campaign.',
  },
  {
    id: 'ev-03',
    capabilityId: 'brand-positioning',
    claim: 'Owns the narrative across Helmcode announcements and model launches.',
    sourceType: 'interview',
    date: 'Today',
    confirmed: true,
    supports: 'First-person account of how positioning decisions get made.',
  },
  {
    id: 'ev-04',
    capabilityId: 'brand-positioning',
    claim: 'Public essays on positioning developer products.',
    sourceType: 'website',
    date: '2024 — 2025',
    confirmed: false,
    supports: 'Demonstrates the thinking in public, beyond a job title.',
  },
  {
    id: 'ev-05',
    capabilityId: 'developer-community',
    claim: 'Grew the Manfred community past 45,000 developers.',
    sourceType: 'verified',
    date: '2019 — 2026',
    confirmed: true,
    supports: 'A verified, large-scale outcome with the candidate at the centre.',
  },
  {
    id: 'ev-06',
    capabilityId: 'developer-community',
    claim: 'Maintains community tooling and open-source examples.',
    sourceType: 'github',
    confirmed: false,
    supports: 'Sustained, visible participation in developer ecosystems.',
  },
  {
    id: 'ev-07',
    capabilityId: 'developer-community',
    claim: 'Regular talks at developer meetups in Madrid and Valencia.',
    sourceType: 'website',
    date: '2022 — 2025',
    confirmed: false,
    supports: 'Shows up where developers actually are, repeatedly.',
  },
  {
    id: 'ev-08',
    capabilityId: 'developer-community',
    claim: 'Describes community-led acquisition motions in detail, including what did not work.',
    sourceType: 'interview',
    date: 'Today',
    confirmed: true,
    supports: 'Depth of understanding that a title alone cannot show.',
  },
  {
    id: 'ev-09',
    capabilityId: 'product-marketing',
    claim: 'Launched Helmcode model cards and pricing pages.',
    sourceType: 'cv',
    date: '2026',
    confirmed: true,
    supports: 'Core product marketing work, shipped.',
  },
  {
    id: 'ev-10',
    capabilityId: 'product-marketing',
    claim: 'Wrote the README and launch copy for ATS Killer.',
    sourceType: 'github',
    confirmed: false,
    supports: 'Product communication authored directly, in public.',
  },
  {
    id: 'ev-11',
    capabilityId: 'product-marketing',
    claim: 'Ran positioning workshops with product teams at Manfred.',
    sourceType: 'cv',
    date: '2023',
    confirmed: true,
    supports: 'Influence beyond own remit, a marker of seniority.',
  },
  {
    id: 'ev-12',
    capabilityId: 'go-to-market',
    claim: 'Led GTM for two Helmcode product launches.',
    sourceType: 'cv',
    date: '2026',
    confirmed: true,
    supports: 'End-to-end ownership of how a product reaches the market.',
  },
  {
    id: 'ev-13',
    capabilityId: 'go-to-market',
    claim: 'Describes pricing and packaging trade-offs without prompting.',
    sourceType: 'interview',
    date: 'Today',
    confirmed: true,
    supports: 'Comfort with commercial decisions, not just communication.',
  },
  {
    id: 'ev-14',
    capabilityId: 'go-to-market',
    claim: 'Public teardown of developer-tools launch strategies.',
    sourceType: 'website',
    date: '2025',
    confirmed: false,
    supports: 'Analytical GTM thinking, demonstrated voluntarily.',
  },
  {
    id: 'ev-15',
    capabilityId: 'content-communication',
    claim: 'Writes a newsletter on AI infrastructure for practitioners.',
    sourceType: 'website',
    date: '2024 —',
    confirmed: false,
    supports: 'Sustained long-form writing for a technical audience.',
  },
  {
    id: 'ev-16',
    capabilityId: 'content-communication',
    claim: 'Wrote engineering-facing communications and docs at Manfred.',
    sourceType: 'cv',
    date: '2022',
    confirmed: true,
    supports: 'Trusted to communicate on behalf of technical teams.',
  },
  {
    id: 'ev-17',
    capabilityId: 'technical-product',
    claim: 'Created MondayBench, a public benchmark for AI models.',
    sourceType: 'github',
    date: '2025',
    confirmed: false,
    supports: 'A real technical artifact, maintained in the open.',
  },
  {
    id: 'ev-18',
    capabilityId: 'technical-product',
    claim: 'ATS Killer: open-source ATS analyzer with 40k+ analyses run.',
    sourceType: 'verified',
    date: '2024 —',
    confirmed: true,
    supports: 'Verified usage at scale for a self-built product.',
  },
  {
    id: 'ev-19',
    capabilityId: 'technical-product',
    claim: 'Ships small product features personally when needed.',
    sourceType: 'interview',
    date: 'Today',
    confirmed: true,
    supports: 'Willingness to get close to the product itself.',
  },
  {
    id: 'ev-20',
    capabilityId: 'ecosystem-partnerships',
    claim: "Built Manfred's partnership program with developer-tools vendors.",
    sourceType: 'cv',
    date: '2024',
    confirmed: true,
    supports: 'Ecosystem work that outlived individual campaigns.',
  },
  {
    id: 'ev-21',
    capabilityId: 'ecosystem-partnerships',
    claim: 'Organized community conferences and local events.',
    sourceType: 'interview',
    date: 'Today',
    confirmed: true,
    supports: 'Operational ownership of community infrastructure.',
  },
  {
    id: 'ev-22',
    capabilityId: 'team-leadership',
    claim: 'Managed a team of three at Manfred.',
    sourceType: 'cv',
    date: '2023 — 2025',
    confirmed: true,
    supports: 'Direct people management, small scope.',
  },
  {
    id: 'ev-23',
    capabilityId: 'team-leadership',
    claim: 'Describes leading mostly through influence across teams.',
    sourceType: 'interview',
    date: 'Today',
    confirmed: true,
    supports: 'Honest reflection on leadership style, from the candidate.',
  },
]

export const evidenceGaps: EvidenceGap[] = [
  {
    id: 'enterprise-sales',
    name: 'Enterprise sales',
    explanation:
      "You've worked around enterprise customers, but I don't yet have enough evidence to understand your direct role.",
    options: [
      'Tell me about it',
      "Add something you've worked on",
      'Add a result',
      'Connect another source',
    ],
  },
  {
    id: 'international-gtm',
    name: 'International GTM',
    explanation:
      'Some signals, but most of your work is Spain-first. I cannot tell how much has been genuinely international.',
    options: [
      'Tell me about it',
      "Add something you've worked on",
      'Add a result',
      'Connect another source',
    ],
  },
  {
    id: 'leadership-at-scale',
    name: 'Leadership at scale',
    explanation:
      "You've owned teams and outcomes. I can't yet tell whether that extends to leading at larger scale.",
    options: [
      'Tell me about it',
      "Add something you've worked on",
      'Add a result',
      'Connect another source',
    ],
  },
]

export function evidenceFor(capabilityId: string): Evidence[] {
  return evidence.filter((e) => e.capabilityId === capabilityId)
}

export function evidenceCount(capabilityId: string): number {
  return evidenceFor(capabilityId).length
}
