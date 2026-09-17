import type { IntentGroup } from '@/domains/candidate/types'

export const intentPrompt = {
  lead: 'One more thing.',
  question:
    'What would have to be true for you to seriously consider leaving your current job?',
  fixtureTranscript:
    'Honestly? Three things. The company has to be genuinely technical — I do my best work close to infrastructure and developers. It has to be early, where the story is still being written, and I want meaningful ownership, not a token grant. Remote from Valencia, non-negotiable. And I would need at least what I would lose by leaving — €120k minimum, more if the equity is real. I am not interested in agencies or pure performance marketing. If it is AI infrastructure or developer tools, my ears perk up.',
}

export const intentInterpretation = {
  lead: "Here's what I'll listen for.",
  groups: [
    { id: 'role', label: 'Role', values: ['CMO', 'Growth leadership'] },
    {
      id: 'space',
      label: 'Space',
      values: ['AI', 'Developer tools', 'Infrastructure'],
    },
    {
      id: 'company',
      label: 'Company',
      values: ['Early stage', 'Strong technical founders'],
    },
    { id: 'compensation', label: 'Compensation', values: ['At least €120,000'] },
    { id: 'ownership', label: 'Ownership', values: ['Meaningful equity'] },
    { id: 'location', label: 'Location', values: ['Remote', 'Valencia'] },
    {
      id: 'not-interested',
      label: 'Not interested in',
      values: ['Agency', 'Pure performance marketing'],
    },
  ] satisfies IntentGroup[],
  confirm: 'Does this represent you?',
  primary: 'Yes, start listening',
  secondary: "Something isn't right",
  secondaryHint: 'Change anything above. I will listen for exactly what you leave here with.',
}

export const listeningFor = [
  'AI infrastructure',
  'Growth leadership',
  'Early stage',
  'Remote',
  'Meaningful ownership',
]
