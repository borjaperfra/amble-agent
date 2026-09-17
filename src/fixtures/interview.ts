import type { InterviewQuestion } from '@/domains/candidate/types'

export const interviewQuestions: InterviewQuestion[] = [
  {
    id: 'helmcode-ownership',
    context: 'I understand what you built at Helmcode.',
    question:
      "What I can't tell is how much of the positioning came directly from you. Tell me about that.",
    why: "Your CV shows that you led Helmcode's launch, but I don't yet know whether you owned the strategy, the execution or both.",
    fixtureTranscript:
      'The positioning was mine. Helmcode set the technical direction, but the narrative — what it is for, who it is for, how we talk about models — that came from me. I wrote the original positioning document and it still holds.',
  },
  {
    id: 'manfred-scale',
    context: 'I can see the Manfred community grew past 45,000 developers.',
    question: 'What part of that growth did you personally own?',
    why: 'Community growth can be brand-led, product-led or founder-led. Which one you drove changes what I understand about you.',
    fixtureTranscript:
      'Community-led, and I mean that literally. I did not run ads — I built the meetups, the content engine and the partnerships that made developers bring other developers. Paid acquisition existed, but it was never the engine.',
  },
  {
    id: 'mondaybench-role',
    context: 'I see MondayBench as a public benchmark for AI models.',
    question: 'What was actually your role in it — yours, or a shared effort?',
    why: 'I can see the repository exists and that you are the author. I cannot tell how much of the methodology and the work behind it was yours.',
    fixtureTranscript:
      "It's mine. The methodology, the harness, most of the writing. A couple of people contributed evals, but the decisions about what to measure and how to publish it were mine.",
  },
  {
    id: 'product-vs-marketing',
    context: 'Your work sits between product and marketing.',
    question: 'Where does the boundary actually sit for you?',
    why: 'Most of what I see could be read as either product work or growth work. Knowing where you actually operate changes how I would represent you.',
    fixtureTranscript:
      "I'm product-shaped marketing. I don't write campaigns about a product — I shape what the product says, and sometimes I build the thing that proves it. ATS Killer started as marketing and became a product.",
  },
  {
    id: 'leadership-scope',
    context: "You've owned outcomes across every team you've been part of.",
    question: 'Have you managed people directly, or led through influence?',
    why: 'Your CV mentions a small team at Manfred. I cannot tell what kind of leadership comes naturally to you, and I would rather not guess.',
    fixtureTranscript:
      'Directly, once — three people, and I learned I am decent at it. But most of my leadership has been through influence: getting engineers, founders and community to move in the same direction without a reporting line.',
  },
]

export const interviewComplete = 'I think I understand you pretty well now.'
