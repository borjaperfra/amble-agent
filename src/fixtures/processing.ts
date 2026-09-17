import type { ProcessingStep } from '@/domains/candidate/types'

export const processingIntro = 'Getting to know you.'

export const processingSteps: ProcessingStep[] = [
  { kind: 'activity', text: 'Reading your CV...' },
  { kind: 'discovery', title: 'Manfred', meta: 'Marketing Manager · 2019 — 2026', source: 'CV' },
  { kind: 'discovery', title: 'Helmcode', meta: 'Growth & Marketing · 2026 —', source: 'CV' },
  {
    kind: 'activity',
    text: 'Looking through your work...',
  },
  {
    kind: 'discovery',
    title: 'ATS Killer',
    meta: 'Open-source ATS analyzer · 40k+ analyses',
    source: 'GitHub',
  },
  { kind: 'discovery', title: 'MondayBench', meta: 'Public AI benchmark', source: 'GitHub' },
  { kind: 'summary', text: 'I found 9 repositories worth looking at.' },
  { kind: 'count', text: 'Found 8 capabilities.' },
  { kind: 'activity', text: 'Connecting the dots...' },
  { kind: 'count', text: 'Found 23 pieces of evidence.' },
]

export const processingDone = {
  line: 'I have the basics.',
  detail: "There are a few things I'd rather ask you myself.",
  cta: 'Continue',
}
