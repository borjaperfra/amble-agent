# AMBLE --- Product & Experience Spec v0.1

**Status:** Build spec\
**Product:** Amble\
**Version:** 0.1\
**Primary objective:** Candidate-side vertical slice

## 1. What Amble is

Amble is your professional representative. It understands what you've
done, what you can actually demonstrate, what matters to you and what
would make your next professional move worth considering. Then it
listens.

You don't need to search continuously, browse job boards, configure
alerts or apply to dozens of positions. Your Rep does the listening for
you. When something genuinely deserves your attention, it tells you.

The long-term ambition is to replace **job → application → screening**
with **intent ↔ evidence ↔ intent**, ultimately creating **Qualified
Mutual Intent** between people and companies.

v0.1 is not a marketplace. It must first prove:

> **Can Amble understand and represent someone professionally better
> than their LinkedIn profile or CV?**

## 2. Brand idea

Amble means moving at an easy, unhurried pace. The user shouldn't feel
like they're job hunting.

No urgency. No red notification badges. No endless opportunities. No
feed. No gamification. No pressure to complete a profile. No artificial
scarcity.

The user continues with their life and career. **Amble listens in the
background.**

## 3. Brand personality

Amble should feel **warm, calm, competent, thoughtful, human, private
and precise.**

It should not feel corporate, HR-tech, recruiter-ish, hyperactive,
gamified, AI-generated, cute, cold or clinical.

The emotional analogy is having an excellent professional representative
who knows you well and doesn't waste your time.

## 4. Experience principle

> **Amble should feel like someone is taking care of something for
> you.**

Most software gives the user work. Amble should remove work.

-   "Complete your profile" → "Let me get to know you."
-   "Add skills" → "Here's what your work demonstrates."
-   "Set job preferences" → "What would make something worth your
    attention?"
-   "You have 7 new matches" → "I found something worth hearing."

The product should consistently make the user feel: **"I don't have to
manage this."**

## 5. Voice

Amble speaks like a thoughtful person: short but not robotic, warm but
not overly enthusiastic, confident but careful about what it knows.

Prefer "I've got a good picture of your work now" over celebratory AI
copy. Prefer "There are a couple of things I'd still like to understand"
over profile-completion percentages. Prefer evidence language over
scores. Prefer "I found something I think you should see" over "Match
found!"

Technical jargon is avoided unless natural to the user's profession.
Emojis should be extremely rare or nonexistent.

## 6. Product experience

The v0.1 journey is:

``` text
Landing
  ↓
Source import
  ↓
Processing
  ↓
Rep interview
  ↓
Professional Map
  ↓
Intent
  ↓
● LISTENING
```

Navigation should barely be necessary. Primary areas are **Your Rep**,
**Your Map**, and **What I'm listening for**. Resist dashboardification.

## 7. Landing

Route: `/`

Primary direction:

``` text
amble

I'm not looking.
Amble is.

Meet your professional Rep.

[ Meet your Rep ]
```

Below the fold:

``` text
It gets to know you.

Not just where you've worked.
What you've actually done.

It learns what matters.

Tell your Rep what would make
something worth your attention.

Then it listens.

You keep doing your thing.
Your Rep will let you know.
```

End with **Remove applications.**

No feature grid, fake testimonials, animated AI network, pricing or
generic SaaS sections in v0.1.

## 8. Source import

Route: `/onboarding`

``` text
Let's build your Rep.

Start with what already exists.
I'll read it before asking
you anything.

[ Upload CV ]
[ Connect GitHub ]

LinkedIn profile
[ __________________ ]

Personal website
[ __________________ ]

Continue →
```

Not every source is required. Do not show "Step 1 of 7." This is a
conversation, not a tax form.

## 9. Source processing

Route: `/onboarding/processing`

Do not use a generic spinner. Make discoveries visible:

``` text
Getting to know you.

Reading your experience...

✓ 4 roles
✓ 9 projects

Looking at your work...

✓ 23 pieces of evidence
✓ 8 capabilities

Connecting the dots...
```

Only show discoveries actually backed by data. Never fake progress
percentages.

Completion:

``` text
I've got the basics.

There are a few things
I'd rather ask you myself.

Continue →
```

## 10. Rep interview

Route: `/onboarding/interview`

This is the heart of onboarding. The interface becomes dramatically
quieter.

``` text
Your Rep

I understand what you did at Manfred.

What I can't tell is how much of the growth
strategy you personally owned.

Tell me about that.

[ Hold to talk ]

or type
```

Voice is first-class; text remains available. Questions are adaptive and
generated from uncertainty in the Professional Graph. Never ask
information Amble already has.

Questions should investigate ownership, outcomes, scope, complexity,
decision-making, collaboration, leadership, relevant technical depth,
measurable impact, contradictions and missing evidence.

Avoid generic interview questions. The Rep is curious, not
interrogative.

### 10.1 Ask about episodes, not attributes

Attribute questions return platitudes. Episode questions return
behaviour.

``` text
How do you work?                         → platitude
Tell me about the last time it went wrong → behaviour

What are you looking for?                → platitude
What would have to happen for you to leave → constraints, floor, dealbreakers
```

The strongest questions are generated from a contradiction or a gap the
system found on its own. A question the candidate can tell was earned by
reading them does not feel like a form.

### 10.2 Defence questions

A second kind of question, with a different purpose. Gap questions fill
what is missing. **Defence questions verify what is already there.**

They exist for `ASSISTED_CLAIM` evidence (§11.1), and they are the only
mechanism that promotes it. A defence question asks the candidate to
justify a decision visible in their own artifact:

``` text
In helmcode-whisper, transcription leaves the machine and
diarization does not. Both are audio.

Why is the line there?
```

Three outcomes:

``` text
Defended    → promote to USER_CLAIM, capability evidence stands
Partial     → keep as ASSISTED_CLAIM, never presented as individual skill
Failed      → retract (§12.1)
```

Defence questions must be asked **before** a profile is shown to any
company, never after. Unverified assisted evidence is the most dangerous
content in the system, because it fails in the flattering direction: it
describes the candidate as more capable than they are, and the candidate
will not correct it.

Tone matters. This is not an exam. The Rep is checking its own
understanding, not testing the person — and when the answer is "I don't
know", that is a normal, useful result, not a failure by the candidate.
The system was wrong, not them.

## 11. Professional Graph

Core relationship:

``` text
Source
   ↓
Fact / Claim
   ↓
Evidence
   ↓
Capability
```

Never:

``` text
LLM
 ↓
Capability
```

A capability requires evidence.

Amble must distinguish:

``` text
SOURCE FACT
USER CLAIM
ASSISTED CLAIM
INFERENCE
VERIFIED FACT
SYSTEM ASSESSMENT
```

These states must never silently collapse into one another. Every
meaningful professional assertion needs provenance.

### 11.1 Assisted claims

A source may be authored by the candidate, by a model working with the
candidate, or by a model the candidate barely supervised. From 2026
onward this is the normal case for code repositories, and it will spread
to writing, design and analysis.

Reading a repository as proof of individual skill is therefore invalid.
A candidate can be the top contributor to a Go service and be unable to
read Go.

``` text
Code in a repository proves that something shipped.
It does not prove who decided what, or who could explain it.
```

`ASSISTED_CLAIM` marks evidence whose author is the candidate *and* a
tool together. It is not weaker than `USER_CLAIM` — it is differently
uncertain. The open question is not whether the statement is true; the
artifact demonstrably exists. The open question is **whose judgment it
represents**.

Assisted claims must never be promoted to capability evidence on
strength alone. They are promoted only by defence (§10.2).

What survives regardless of attribution, and should be extracted
separately:

``` text
Choice of what to build        (precedes any tool)
Shipping and operating it      (outcome is real either way)
Sustained working method       (consistency is not delegated)
Empirical debugging signature  (behaviour, not authorship)
```

## 12. Evidence

Evidence is a first-class object.

``` text
Evidence {
  id
  candidate_id
  capability_id
  claim
  source_type
  source_id
  source_uri
  source_excerpt
  extracted_at
  extractor_model
  extractor_version
  prompt_version
  evidence_strength
  corroborated_by[]
  contradicted_by[]
  candidate_confirmed
  human_verified
  attribution            // sole | assisted | unknown
  attribution_tool       // the agent, when known
  defence_status         // undefended | defended | partial | failed
  defence_turn_id
  retracted_at
  retracted_reason
  retracted_by_turn
  valid_from
  valid_until
  created_at
  updated_at
}
```

The implementation may evolve. The principle cannot.

### 12.1 Retraction

Evidence is retracted, never deleted.

A retraction is a first-class, visible event: the claim stays in the
record with the question that defeated it and the answer that defeated
it. The Professional Map hides retracted evidence from capability
assessment and shows it in the audit trail.

``` text
⊘ Retracted

  "Product judgment in technical decisions"

  Asked:    Why is the privacy line drawn there?
  Answered: No idea. Claude Code decided that.
```

Deleting a retracted claim would erase the most valuable record the
system holds: what it believed, and why it stopped believing it.

Retraction applies to any epistemic state, but assisted claims are its
main source. A system that cannot retract will inflate every candidate
it reads, and inflation is the one failure this product cannot survive.

## 13. Professional Map

Route: `/me`

This is the first major reward. It should feel like an editorial
professional profile, not another dashboard.

``` text
YOUR PROFESSIONAL MAP

Borja Pérez Francés

Marketing · Growth · Community · AI

WHAT YOUR WORK DEMONSTRATES

Brand & positioning
Strong evidence

Developer community
Strong evidence

Product marketing
Strong evidence

Go-to-market
Good evidence

YOUR DISTINCTIVE PROFILE

AI infrastructure
      ×
Developer communities
      ×
Brand & growth

THINGS I DON'T KNOW YET

Enterprise sales
Limited evidence

International GTM
Some evidence

Leadership at scale
Limited evidence
```

Example facts are fixtures only.

Never produce a universal Professional Score or generic percentile. A
person's professional value is contextual.

Use evidence language such as **Strong evidence, Good evidence, Some
evidence, Limited evidence, No evidence yet, Contradictory evidence**.
Avoid Excellent, Average, Poor, Weak candidate, Expert or 10/10.

## 14. Evidence gaps

Evidence gaps are useful, not negative.

``` text
Technical leadership

You've described significant technical ownership.

I don't yet have enough evidence to distinguish
ownership from leadership.

[ Strengthen evidence ]
```

Strengthening can mean explaining something, adding a project,
connecting a repository, providing an artifact, adding a measurable
result or requesting verification.

### 14.1 Two kinds of uncertainty

``` text
MATERIALITY   I don't know whether this matters
ATTRIBUTION   I don't know whose this is
```

They resolve differently. Materiality is resolved by a gap question or
by another source. Attribution is resolved only by defence (§10.2) —
finding a second source that says the same thing proves nothing, because
the second source may have the same author.

Attribution uncertainty must be raised automatically for every capability
whose supporting evidence is majority `ASSISTED_CLAIM`.

### 14.2 Sources the system cannot read

Some evidence has no machine-readable source at all. Audience size on X
and LinkedIn, view counts, speaking history, private revenue numbers.

For a community, marketing or sales profile these are not decoration —
they are the primary evidence, and no API provides them.

The honest handling is to name the gap as a gap the *system* has, ask the
candidate to supply the figure, and mark it `USER_CLAIM` with no
corroboration. Never infer an audience from a follower-less profile, and
never let a missing metric read as a missing capability.

## 15. Intent

Route: `/me/intent`

Only ask once Amble understands the person reasonably well:

``` text
One more thing.

What would have to be true for you
to seriously consider leaving your
current job?

[ Hold to talk ]

or type
```

Let the person explain before presenting structured controls.

Extract:

``` text
status
roles
industries
technologies
company stages
minimum compensation
preferred compensation
equity preference
locations
remote preference
company characteristics
hard constraints
soft preferences
privacy rules
last confirmed
```

Show the interpretation back and require confirmation before activating
it.

Intent must have `created_at`, `confirmed_at` and `valid_until`. Stale
intent must not silently be treated as current forever.

## 16. Listening

Route: `/listening`

``` text
amble

● LISTENING

I'll only interrupt you when
something deserves your attention.

Currently listening for

AI infrastructure
CMO / Growth leadership
Early-stage
Remote
Meaningful equity

[ Change what I'm listening for ]

Your Professional Map →
```

No fake activity, scanning counters or match counts. **Silence is a
feature.**

A successful empty state:

``` text
● LISTENING

Nothing worth bothering you with.

I'm still listening.
```

## 17. Future opportunity moment

Not required for v0.1, but anticipate:

``` text
Your Rep found something.

I think you should see this.
```

The opportunity view should explain why it is being shown and what
uncertainty remains. Never use a generic match percentage. **The
explanation is the product.**

## 18. Privacy and control

Professional Map and Intent Profile are private by default, especially
compensation, willingness to move, hard no's, current-company concerns
and private interview answers.

Users must be able to inspect claims and evidence, correct facts,
dispute an inference, remove evidence, add context, change intent, stop
listening and delete their Rep.

The experience should communicate: **"My Rep understands me, and I can
correct it."**

## 19. Auditability

Design as if every meaningful decision may eventually need to be
explained.

Store:

``` text
ModelRun
Decision
AuditEvent
HumanOverride
Retraction
RubricVersion
```

`Retraction` records the evidence id, the defence question asked, the
answer given, the timestamp and the resulting state. It is append-only
without exception.

ModelRun should capture model, provider, model version, prompt version,
input references, structured output and timestamp.

Decision events should be append-only where practical.

Models propose. Domain logic validates. Humans retain control over
consequential decisions.

``` text
INPUT
 ↓
MODEL
 ↓
STRUCTURED PROPOSAL
 ↓
SCHEMA VALIDATION
 ↓
DOMAIN RULES
 ↓
PERSIST
 ↓
AUDIT EVENT
```

Avoid `MODEL → DATABASE`.

## 20. Technical architecture

Prefer a modular monolith:

``` text
Frontend: Next.js / React / TypeScript
Backend: TypeScript
Database: PostgreSQL + pgvector
Storage: S3-compatible
Queue: simple job queue
Models: provider abstraction
Speech-to-text: provider abstraction
```

No Kubernetes, Kafka or microservices without a real need.

Suggested domains:

``` text
/domains
candidate/
  profile
  sources
  evidence
  capability
  intent
  interview

matching/
  gates
  evidence_match
  intent_match
  uncertainty
  explanation

opportunity/
  company
  role
  rubric

sourcing/
  search
  discovery
  outreach
  qmi

audit/
  events
  decisions
  model_runs
  overrides
```

Core v0.1 entities:

``` text
User
Candidate
ProfessionalProfile
Source
Experience
Project
Repository
Capability
Evidence
EvidenceLink
Interview
InterviewTurn
IntentProfile
IntentConstraint
ModelRun
Decision
AuditEvent
HumanOverride
```

Prefer explicit relationships over giant JSON blobs.

## 21. Model abstraction and evaluation

No business logic should depend directly on one provider.

Conceptually:

``` text
ModelProvider
extract()
reason()
interview()
structure()
explain()
```

Store the model used for relevant runs and version prompts.

Build an evaluation harness early with frozen professional-profile
fixtures. Test evidence grounding, unsupported claims, capability
extraction, contradictions, interview quality, intent extraction and
explanation fidelity.

Unsupported professional claims should approach zero.

## 22. Sprint 01

Routes:

``` text
/
/onboarding
/onboarding/processing
/onboarding/interview
/me
/me/intent
/listening
```

Priority:

**P0:** Complete navigable vertical slice with seeded/mock data.\
**P1:** Real CV parsing, evidence extraction, adaptive interview,
Professional Graph persistence, Intent extraction.\
**P2:** GitHub integration, voice, evidence-strengthening flows.

Do not block UX iteration on production integrations.

For each major screen: build the interaction, make it excellent with
realistic fixture data, validate the mental model, then connect backend
behaviour.

## 23. Things we deliberately do not build

v0.1 does not need a job board, candidate feed, social network,
messaging platform, ATS, recruiter CRM, company dashboard, payments,
subscription management, referral system, public profiles, universal
candidate ranking, application tracking, gamification, engagement
notifications or complex organization management.

## 24. UX quality bar

For every screen ask:

-   Can anything be removed?
-   Are we asking something we could know ourselves?
-   Does this feel like work?
-   Does the user understand why Amble is asking?
-   Are we exposing implementation details instead of meaning?
-   Does this increase trust?
-   Would silence be better?
-   Could this be one thoughtful sentence instead of a UI component?

## 25. Initial research cohort

Onboard approximately 10 people once the vertical slice works.

Primary question:

> **Does this represent you professionally better than your LinkedIn
> profile or CV?**

Then ask what it misunderstood, what is missing, what surprised them,
what felt too personal, what they would not want a company to see and
whether they would trust their Rep to decide when an opportunity
deserves attention.

Track corrections. Corrections are valuable product data.

## 26. v0.1 success criteria

Do not measure initial success by signups.

Success means users feel accurately represented:

-   professional claims are evidence-grounded
-   unsupported claims are extremely rare
-   users make few factual corrections
-   interview questions feel relevant
-   Evidence Gaps are understood
-   users willingly configure private intent
-   users would leave their Rep Listening
-   users prefer the representation to their CV/LinkedIn

Strongest qualitative signal:

> **"This gets me."**

## 27. Product invariant

> **Amble represents people. It doesn't rank them.**

> **The user shouldn't have to look. Their Rep is listening.**

Amble should feel like having someone thoughtful on your side: **quiet
enough to trust, warm enough to return to, precise enough to believe.**

The user closes the browser.

Amble keeps listening.

**That is the product.**
