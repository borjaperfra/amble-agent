/**
 * The Opportunity Zero test set.
 *
 * Ten opportunities written against the demo candidate: marketing, growth
 * and community around technology, listening for AI infrastructure and
 * developer tools, early stage, remote from Valencia, at least €120k, with
 * meaningful equity, and explicitly not interested in agencies or pure
 * performance marketing.
 *
 * They are not ten good matches. They are ten different ways of being
 * nearly right, because what is being measured is calibration — whether
 * Amble can tell the difference between an opportunity worth someone's
 * attention and one that merely resembles it.
 *
 * `blindLabel` is the answer the fixture was written to have, recorded at
 * the same time as the text and before anything was run against it. It is
 * stored with origin "fixture" so it is never confused with a label the
 * candidate gave themselves in the lab. It never reaches the model.
 *
 * Deliberately free of imports: the measurement harness is a plain .mjs
 * script and loads this file directly.
 */

export interface OpportunityFixture {
  key: string
  company: string
  role: string
  url: string | null
  /** What it is testing, for the harness report. Never sent to the model. */
  shape: string
  blindLabel: 'YES' | 'MAYBE' | 'NO'
  blindComment: string
  rawText: string
}

export const opportunityFixtures: OpportunityFixture[] = [
  {
    key: 'opp-nurse',
    company: 'Hospital General de Levante',
    role: 'Enfermero/a de planta',
    url: null,
    shape: 'Clearly irrelevant',
    blindLabel: 'NO',
    blindComment: 'Nothing to do with anything.',
    rawText: `Hospital General de Levante busca enfermero/a para planta de medicina interna.

Turnos rotativos de mañana, tarde y noche, incluyendo fines de semana. Contrato indefinido tras seis meses. Salario según convenio: 28.000 - 32.000 euros brutos anuales más pluses de nocturnidad.

Requisitos: Grado en Enfermería, colegiación vigente en la Comunidad Valenciana, experiencia mínima de dos años en planta hospitalaria. Se valorará formación en cuidados críticos.

Incorporación inmediata. Presencial en Valencia.`,
  },
  {
    key: 'opp-agency-growth',
    company: 'Velocity Digital',
    role: 'Head of Growth',
    url: 'https://example.com/velocity/head-of-growth',
    shape: 'Superficially relevant, wrong on the thing they ruled out',
    blindLabel: 'NO',
    blindComment: 'It is an agency doing paid acquisition. Both of the two things he said no to.',
    rawText: `Velocity Digital is a performance marketing agency working with 40+ B2B SaaS and AI clients across Europe. We are hiring a Head of Growth to lead paid acquisition across our client portfolio.

You will own media buying strategy across Google, LinkedIn and Meta, manage a team of four performance specialists, and be accountable for blended CAC and ROAS targets across accounts. Weekly client reporting and quarterly business reviews are a core part of the role.

We work with some of the most exciting AI companies in the market, so you will be close to the space.

Requirements: 5+ years in performance marketing, strong analytics, experience managing six-figure monthly ad budgets, agency background preferred.

Remote-friendly within Spain. 70.000 - 85.000 euros plus performance bonus.`,
  },
  {
    key: 'opp-enterprise-marketing',
    company: 'Adventa Software',
    role: 'Marketing Director',
    url: 'https://example.com/adventa/marketing-director',
    shape: 'Good capability match, bad intent match',
    blindLabel: 'NO',
    blindComment:
      'He could do this in his sleep. Enterprise, on-site Madrid, no ownership, below the number. Everything he moved away from.',
    rawText: `Adventa Software is a leading enterprise resource planning vendor with 4,200 employees across 14 countries. Founded in 1998, we serve manufacturing and logistics companies throughout Europe.

We are looking for a Marketing Director to lead a team of eleven covering demand generation, product marketing, events and corporate communications. You will report to the CMO and be responsible for the EMEA marketing plan and its budget.

Responsibilities include brand consistency across regions, pipeline contribution targets, analyst relations, and the annual customer conference.

Requirements: 8+ years in B2B marketing, at least 3 leading a team, experience with long enterprise sales cycles, fluent English and Spanish.

Based in our Madrid office, three days on site. 90.000 - 105.000 euros plus 15% annual bonus.`,
  },
  {
    key: 'opp-vp-engineering',
    company: 'Tensorlake',
    role: 'VP of Engineering',
    url: 'https://example.com/tensorlake/vp-engineering',
    shape: 'Good intent match, no evidence for the work itself',
    blindLabel: 'NO',
    blindComment:
      'Exactly the kind of company he wants, and not remotely his job. I would be annoyed to be shown this.',
    rawText: `Tensorlake builds distributed inference infrastructure for teams running large models in production. We are 14 people, seed funded by tier-one investors, and our founders previously built the scheduling layer at a major cloud provider.

We are hiring a VP of Engineering to lead the team as we scale from 8 engineers to 25 over the next eighteen months. You will own architecture decisions for our scheduling and routing layer, set the engineering hiring bar, and work directly with the founders on the technical roadmap.

Requirements: 10+ years building distributed systems, at least 4 years leading engineering teams, deep experience with GPU workloads, Kubernetes at scale, and low-latency serving.

Fully remote across European timezones. 140.000 - 170.000 euros plus meaningful equity.`,
  },
  {
    key: 'opp-founding-cmo-nopay',
    company: 'Keelhaul',
    role: 'Founding CMO',
    url: 'https://example.com/keelhaul/founding-cmo',
    shape: 'Strong match, compensation not disclosed',
    blindLabel: 'MAYBE',
    blindComment: 'Right shape entirely. I would want to know the number before I spent an evening on it.',
    rawText: `Keelhaul is building the deployment layer for AI agents. Developers ship agents to us and we handle sandboxing, observability and rollback. We are pre-Series A, twelve people, and our users are developers.

We are looking for our founding marketing hire. You would own everything: positioning, the developer community, the docs experience, launches, and the story we tell. You would be the first non-engineering voice in the room and you would report to the CEO.

This is a role for someone who has built an audience of developers before and knows the difference between marketing to them and marketing at them.

Requirements: you have taken a technical product to a technical audience. You are comfortable close to infrastructure. You write well.

Fully remote, European timezones. Meaningful founding equity. Compensation is competitive and we will discuss it openly on the first call.`,
  },
  {
    key: 'opp-series-a-unclear-scope',
    company: 'Northbound',
    role: 'Head of Growth',
    url: 'https://example.com/northbound/head-of-growth',
    shape: 'Strong match with one material uncertainty: who owns what',
    blindLabel: 'MAYBE',
    blindComment:
      'On paper it is right. But "partner closely with the CRO" usually means the CRO owns it and you run campaigns.',
    rawText: `Northbound provides vector search infrastructure for companies building retrieval systems. Series A, 38 people, strong developer adoption with 9,000 GitHub stars and a busy community.

We are hiring a Head of Growth to accelerate our self-serve funnel and developer adoption. You will partner closely with the CRO to align growth with the enterprise sales motion, run experiments across the free-to-paid journey, and work with the developer relations team on content and community.

The role reports into the commercial organisation.

Requirements: experience growing a developer-first product, comfort with technical content, data-driven approach to funnel work.

Remote within Europe. 125.000 - 140.000 euros. Equity included.`,
  },
  {
    key: 'opp-strong-ai-infra',
    company: 'Halvard',
    role: 'Head of Growth & Community',
    url: 'https://example.com/halvard/growth-community',
    shape: 'Clearly strong',
    blindLabel: 'YES',
    blindComment: 'If Amble does not show me this one, it is not working.',
    rawText: `Halvard runs an EU-based inference platform. Developers point an OpenAI-compatible endpoint at us and get open models running in European data centres. We are 19 people, seed funded, and both founders are engineers who were running infrastructure before they started the company.

We are hiring a Head of Growth & Community, our first senior marketing hire, reporting to the CEO. You will own the full picture: how developers find us, what they read when they arrive, the community around the product, and the story we tell about European AI infrastructure.

You will own the budget and the roadmap for it. There is no one above you in marketing and there will not be for some time.

Requirements: you have grown a developer audience before, you are comfortable with infrastructure concepts, and you can write.

Fully remote, anywhere in Europe. 130.000 - 150.000 euros plus 0.8% - 1.2% equity on a four-year vest.`,
  },
  {
    key: 'opp-thin-posting',
    company: 'Unnamed AI startup',
    role: 'Growth lead',
    url: null,
    shape: 'Incomplete job description',
    blindLabel: 'MAYBE',
    blindComment: 'There is nothing here to decide on. Find out more before you bother me.',
    rawText: `Growth lead wanted. Early AI startup, small team, moving fast. Developer product.

You would be our first marketing person. Interesting problem, good people.

Get in touch if this sounds like you.`,
  },
  {
    key: 'opp-below-floor',
    company: 'Runeforge',
    role: 'Head of Marketing',
    url: 'https://example.com/runeforge/head-of-marketing',
    shape: 'Right in every way except the number',
    blindLabel: 'NO',
    blindComment: 'He told us 120 and meant it. This is 80.',
    rawText: `Runeforge builds open-source developer tooling for local model workflows. Seed stage, nine people, remote-first across Europe. Our founders are both long-time open-source maintainers.

We are looking for our first Head of Marketing to own positioning, community and the developer story end to end. You would report to the CEO and have full ownership of how we are seen.

Requirements: experience marketing to developers, comfort with technical products, strong writing.

Fully remote. 75.000 - 80.000 euros plus 0.5% equity. We know that is below market for the seniority and we are upfront about it: the equity is where the upside is.`,
  },
  {
    key: 'opp-onsite-berlin',
    company: 'Kessler Labs',
    role: 'Head of Developer Marketing',
    url: 'https://example.com/kessler/developer-marketing',
    shape: 'Right in every way except where you have to be',
    blindLabel: 'NO',
    blindComment: 'Remote from Valencia was non-negotiable. This is four days in Berlin.',
    rawText: `Kessler Labs is building training infrastructure for teams fine-tuning open models. Series A, 45 people, technical founders out of a research lab.

We are hiring a Head of Developer Marketing to own how developers discover, evaluate and adopt our platform. You will lead community, content, developer education and launches, with a small team and room to grow it.

This is an in-person culture. We work from our Berlin office four days a week and we are not flexible on that — the way we work depends on being in the same room.

Requirements: you have built a developer audience, you are technical enough to be credible, and you want to be close to the product.

Berlin, four days on site, relocation support available. 130.000 - 145.000 euros plus equity.`,
  },
]

/**
 * The gap set.
 *
 * Eight offers that all fit: growth or marketing leadership, AI
 * infrastructure or developer tools, early stage, remote, at or above the
 * floor, equity, and not one of them an agency or a paid-acquisition job. On
 * the calibration set the question was whether Amble can tell a near-miss
 * from a match. Here it is not — every one of these should be interesting.
 *
 * What each is missing, or gets wrong, is the test. One thing per fixture,
 * so that when the answer is HOLD there is exactly one right question to ask
 * and it is obvious whether Amble asked it. That question is the product: a
 * hold that cannot say what would end it is a shrug.
 *
 * The labels are mostly MAYBE on purpose. Somebody who wants this job still
 * would not say yes without knowing what it pays.
 */
export const gapFixtures: OpportunityFixture[] = [
  {
    key: 'gap-no-salary',
    company: 'Runik',
    role: 'Head of Growth',
    url: null,
    shape: 'Right in every way, says nothing about pay',
    blindLabel: 'MAYBE',
    blindComment: 'I want this. Tell me the number before I spend an evening on it.',
    rawText: `Runik is building the observability layer for teams running open models in production. Seed funded, fourteen people, both founders were infrastructure engineers before this.

We are hiring our first Head of Growth, reporting to the CEO. You would own how developers find us, what they read when they get here, the community, and the story we tell. No one above you in marketing, and the budget and the roadmap for it are yours.

Requirements: you have grown a developer audience before, you are comfortable with infrastructure concepts, and you write well.

Fully remote across Europe. Meaningful equity on a four-year vest.`,
  },
  {
    key: 'gap-no-work-model',
    company: 'Palomar Systems',
    role: 'Head of Growth & Community',
    url: null,
    shape: 'Right in every way, never says whether it is remote',
    blindLabel: 'MAYBE',
    blindComment: 'Remote is not negotiable for me. If it is not remote this conversation is over.',
    rawText: `Palomar Systems runs a GPU scheduling platform used by teams fine-tuning open models. Series A, twenty-two people, developer-first from day one.

We are looking for a Head of Growth & Community as our first senior marketing hire, reporting directly to the CEO. You will own developer acquisition, technical content, the community, and how we talk about ourselves. The budget is yours.

Requirements: experience growing a technical audience, comfort close to infrastructure, strong writing.

135.000 - 155.000 euros plus 0,7% - 1% equity on a four-year vest. Offices in Barcelona and Lisbon.`,
  },
  {
    key: 'gap-competitive-salary',
    company: 'Thornwell',
    role: 'Founding Head of Marketing',
    url: null,
    shape: 'Says something about pay that is not a number',
    blindLabel: 'MAYBE',
    blindComment: 'Competitive has meant below my number every single time.',
    rawText: `Thornwell is the deployment layer for AI agents: developers ship agents to us and we handle sandboxing, rollback and observability. Pre-Series A, sixteen people, and our users are developers.

We are hiring our founding marketing person. You would own positioning, the developer community, the docs experience, launches, and the story we tell. You would report to the CEO and be the first non-engineering voice in the room.

Requirements: you have taken a technical product to a technical audience, you are comfortable close to infrastructure, and you write well.

Fully remote, European timezones. Meaningful founding equity. Compensation is competitive and benchmarked against European seed-stage rates.`,
  },
  {
    key: 'gap-usd-salary',
    company: 'Ridgeline AI',
    role: 'Head of Growth',
    url: null,
    shape: 'Pays well, but in a currency the floor is not in',
    blindLabel: 'MAYBE',
    blindComment: 'Is that above or below my number? I do not know without a rate.',
    rawText: `Ridgeline AI builds the routing layer for inference across providers. Seed stage, eighteen people, US-incorporated with a European team.

We are hiring a Head of Growth to own developer acquisition end to end: content, community, docs, launches and the narrative. You report to the CEO and own the budget.

Requirements: you have grown a developer audience, you are technical enough to be credible, and you write.

Fully remote, European timezones. 145,000 - 165,000 USD plus 0.6% - 1% equity on a four-year vest.`,
  },
  {
    key: 'gap-contradictory-location',
    company: 'Vessel Compute',
    role: 'Head of Growth & Developer Relations',
    url: null,
    shape: 'Contradicts itself about where the work happens',
    blindLabel: 'MAYBE',
    blindComment: 'It says remote at the top and four days in an office at the bottom. Which one?',
    rawText: `Vessel Compute runs European inference infrastructure for teams that cannot send data outside the EU. Series A, twenty-six people.

FULLY REMOTE — work from anywhere in Europe.

We are hiring a Head of Growth & Developer Relations, our first senior marketing hire, reporting to the CEO. You own developer acquisition, content, community and the narrative, along with the budget.

Requirements: you have grown a developer audience, you are comfortable with infrastructure, and you write well.

How we work: our culture depends on being in the same room, so the team is in the Madrid office four days a week. Fridays are yours.

130.000 - 150.000 euros plus 0,8% equity.`,
  },
  {
    key: 'gap-scope-ambiguous',
    company: 'Harlow Data',
    role: 'Head of Growth',
    url: null,
    shape: 'The title and the body describe two different jobs',
    blindLabel: 'MAYBE',
    blindComment: 'Head of Growth on the tin, SDR manager in the description. Which am I offered?',
    rawText: `Harlow Data provides the vector layer for retrieval systems. Series A, thirty-one people, strong developer adoption.

We are hiring a Head of Growth, reporting to the CRO.

You will build and manage a team of four SDRs, own the outbound sequences, run weekly pipeline reviews, and be accountable for qualified meetings booked per quarter. You will work with the CRO on territory planning and quota setting.

There is also a content and community side to the role that you would shape over time.

Requirements: experience leading a pipeline-generation team, comfort with technical products, strong analytics.

Fully remote within Europe. 125.000 - 140.000 euros plus equity.`,
  },
  {
    key: 'gap-unknown-stage',
    company: 'Corbel',
    role: 'VP Marketing',
    url: null,
    shape: 'Says nothing about how big or how funded the company is',
    blindLabel: 'MAYBE',
    blindComment: 'Early stage was the whole point. This could be nine people or nine hundred.',
    rawText: `Corbel builds developer tooling for local model workflows: run, evaluate and ship open models without leaving your laptop.

We are hiring a VP Marketing to own the whole function — positioning, the developer community, content, launches and the narrative. You report to the CEO and own the budget and the roadmap for it.

Requirements: you have marketed a technical product to developers, you are comfortable with the subject matter, and you can write.

Fully remote across Europe. 130.000 - 150.000 euros plus meaningful equity on a four-year vest.`,
  },
  {
    key: 'gap-about-the-candidate',
    company: 'Solenne',
    role: 'Head of Community & Growth',
    url: null,
    shape: 'Nothing missing on their side; the gap is in what we know about him',
    blindLabel: 'YES',
    blindComment:
      'Nothing missing on their side. If Amble is unsure about me, it should ask me, not go quiet.',
    rawText: `Solenne runs an EU-based inference platform with an OpenAI-compatible endpoint. Seed funded, seventeen people, and both founders are infrastructure engineers.

We are hiring a Head of Community & Growth, our first senior marketing hire, reporting to the CEO. You own the whole picture: how developers find us, the docs experience, the community, and the story we tell about European AI infrastructure. The budget and the roadmap are yours, and there will be no one above you in marketing for a long time.

What this role really turns on is community. We expect you to have run a developer community before — a Discord, a forum, a meetup series, something with your name on it — and to be able to point at what it became.

Requirements: you have grown a developer audience, you have built a community with your own hands, you are comfortable with infrastructure concepts, and you write.

Fully remote, anywhere in Europe. 132.000 - 152.000 euros plus 0,9% - 1,3% equity on a four-year vest.`,
  },
]
