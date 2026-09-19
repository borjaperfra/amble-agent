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
