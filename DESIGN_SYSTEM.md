# AMBLE --- Design System & UI Direction v0.1

**Status:** Build spec\
**Product:** Amble\
**Version:** 0.1\
**Purpose:** Define the visual and interaction language for the first
Amble product.

## 1. Design thesis

Amble should feel like:

> **a quiet, beautifully designed place where someone competent is
> taking care of your professional life.**

Not software you have to operate. Not an HR dashboard. Not an AI
interface. Not a social network.

The visual system combines **editorial warmth + product precision +
subtle physicality**.

Three words guide every decision:

> **Calm. Warm. Considered.**

## 2. Reference feeling

The desired emotional territory is closer to a beautifully typeset book,
a quiet independent hotel, a well-designed notebook, a thoughtful
personal letter, a premium editorial publication and a calm room with
natural materials than LinkedIn, Workday, generic SaaS, futuristic AI
products or crypto interfaces.

Amble should look contemporary without looking technological for the
sake of it.

## 3. Canvas and palette

``` css
:root {
  --paper: #F4F1EA;
  --paper-light: #FAF8F3;
  --paper-dark: #E8E4DA;

  --ink: #25251F;
  --ink-secondary: #67675F;
  --ink-tertiary: #929187;

  --moss: #52634F;
  --moss-dark: #3F4D3D;
  --moss-soft: #DDE3D8;
  --moss-wash: #EBEFE7;

  --clay: #A76E58;
  --clay-soft: #EFE0D9;

  --ochre: #A0834F;
  --ochre-soft: #EEE7D6;

  --slate: #667074;
  --slate-soft: #E1E5E5;

  --border: #DCD8CE;
  --border-soft: #E8E4DB;
}
```

Never use absolute black for normal text. Moss is the Amble accent and
should feel botanical and mature, not like "success green".

Use secondary functional colours sparingly. Do not create a rainbow UI.

Whitespace is the primary container. Avoid placing every section inside
a card.

## 4. Evidence is not traffic-light coloured

Never map Strong → green, Medium → yellow, Weak → red.

Evidence is epistemic information, not judgment.

Prefer visual weight:

``` text
Strong evidence       ●●●●
Good evidence         ●●●○
Some evidence         ●●○○
Limited evidence      ●○○○
No evidence yet       ○○○○
```

Colour can reinforce state subtly but cannot carry meaning alone.

## 5. Typography

Preferred pairing:

**Newsreader** --- display/editorial\
**Inter** --- product/UI

Use Newsreader for landing hero, large questions, emotional transitions,
major Professional Map statements and occasional empty states.

Use Inter for controls, navigation, labels, evidence, body text,
metadata and forms.

Alternatives: Instrument Serif or Source Serif 4 for display; Geist for
UI.

Do not use serif for every heading.

Type scale:

``` css
--display-xl: 72px;
--display-lg: 56px;
--heading-xl: 40px;
--heading-lg: 32px;
--heading-md: 24px;
--heading-sm: 20px;
--body-lg: 18px;
--body: 16px;
--body-sm: 14px;
--label: 12px;
```

Large display text:

``` css
line-height: 0.98;
letter-spacing: -0.025em;
```

Adjust line-height up to `1.08` as needed.

Body should use roughly `1.5–1.65` line-height.

Small uppercase labels can provide editorial hierarchy:

``` text
WHAT YOUR WORK DEMONSTRATES
```

Use approximately 11px, 600 weight and 0.09em letter spacing. Use
sparingly.

## 6. Layout and spacing

``` css
--page-max: 1280px;
--reading-max: 720px;
--conversation-max: 760px;
--map-max: 1080px;
```

Horizontal padding:

``` text
desktop: 48–64px
tablet: 32px
mobile: 20px
```

Base spacing unit: `4px`.

Preferred rhythm:

``` text
4 8 12 16 24 32 48 64 96 128
```

Large whitespace is intentional. Do not fill empty space because it
looks unfinished.

## 7. Shape, borders and shadows

``` css
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;
--radius-xl: 24px;
```

Buttons and inputs generally use 10px radius. Large contextual surfaces
can use 16px. Pills are reserved for genuine tags/status.

Borders:

``` css
--border: #DCD8CE;
--border-soft: #E8E4DB;
```

Use whitespace and typography before borders.

Almost no shadows. When elevation is genuinely required:

``` css
box-shadow:
  0 1px 2px rgba(37,37,31,.04),
  0 8px 24px rgba(37,37,31,.05);
```

A tiny 1--2% background noise texture is acceptable if nearly
imperceptible and performant.

## 8. Brand and logo

For v0.1 use a lowercase wordmark:

``` text
amble
```

Do not rush an icon.

Avoid footprints, paths, walking icons, briefcases, people silhouettes,
AI stars, sparkles and network nodes.

No literal symbol is better than a mediocre one.

## 9. Header and navigation

Minimal:

``` text
amble                              Your Rep     Your Map      ···
```

No persistent sidebar in v0.1. A sidebar would immediately make the
product feel like enterprise software.

## 10. Buttons and inputs

Primary buttons use dark ink or moss:

``` text
Meet your Rep →
```

Approximately:

``` css
height: 48px;
padding: 0 20px;
border-radius: 10px;
```

No gradients, glow or giant shadows.

Many actions should simply be text:

``` text
Change something
View evidence →
Not quite
```

Inputs:

``` css
background: var(--paper-light);
border: 1px solid var(--border);
border-radius: 10px;
```

Focus uses moss plus a very subtle focus ring. Labels sit above fields.
Avoid placeholder-only forms.

Hover transitions should generally be 150--180ms with subtle darkening.
Avoid exaggerated scaling.

## 11. Source import

Do not create four giant integration cards.

Prefer:

``` text
Start with what already exists.

┌───────────────────────────────────────────┐
│ CV                                       │
│ Drop a PDF here                          │
│                                  Add →    │
└───────────────────────────────────────────┘

GitHub                           Connect →
LinkedIn                         Add profile →
Website                          Add →
```

Connected:

``` text
GitHub
borjaperezfrances                    ✓
```

Simple.

## 12. Processing screen

This should feel alive without looking like a loading interface.

``` text
Getting to know you.

Manfred
Marketing Manager
2019 — 2026                            ✓

Helmcode
Growth & Marketing
2026 —                                 ✓

Found 7 capabilities.

Connecting them to your work...
```

Discoveries enter individually:

``` text
opacity 0 → 1
translateY 4px → 0
duration 300–400ms
```

Do not animate everything simultaneously.

Completion:

``` text
I have the basics.

There are a few things
I'd rather ask you myself.

Continue →
```

The transition should feel like moving from ingestion to conversation.

## 13. Interview screen

This is a signature Amble screen. Almost everything disappears.

``` text
amble                                         Save & leave

                         YOUR REP

          I understand what you built at Helmcode.

        What I can't tell is how much of the
        positioning came directly from you.

                    Tell me about that.

                  ┌───────────────┐
                  │       ●       │
                  │ Hold to talk  │
                  └───────────────┘

                       or type
```

The question occupies the visual centre. Serif can be used for the main
question; supporting context uses sans.

Do not implement a permanent ChatGPT-like bubble transcript. The current
question is the interface.

## 14. Voice interaction

Voice should be one of Amble's best interactions.

Idle:

``` text
        ●
   Hold to talk
```

Recording:

``` text
        ◉
      00:18

      Listening
```

A subtle waveform or organic amplitude-reactive line is acceptable.

Use moss, not bright red.

Silence is not failure. Keep recording when the user pauses. No
countdown or "Are you still there?"

People need time to think about their careers.

## 15. Interview transitions and trust

After an answer, "Got it." can appear briefly where natural. Then
quietly transition to the next question.

Use a subtle:

``` text
Why this question?
```

Example explanation:

``` text
Your CV shows that you led this project,
but I don't yet know whether you owned the
strategy or the execution.
```

This builds trust.

## 16. Professional Map

Do not make it a dashboard. Treat it like an editorial profile.

``` text
YOUR PROFESSIONAL MAP

Borja Pérez Francés

Marketing, growth and community
around technology.

Last updated today
```

Capability presentation:

``` text
WHAT YOUR WORK DEMONSTRATES

Brand & positioning

Strong evidence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your work across Manfred and Helmcode
shows repeated ownership of positioning,
narrative and product communication.

4 pieces of evidence                         View →
```

Avoid percentages, scores and radar charts.

The evidence explanation matters more than a meter.

## 17. Evidence detail

Clicking evidence opens a contextual side drawer on desktop and a bottom
sheet on mobile.

Show evidence items, sources, dates where appropriate, confirmation
state and why the evidence supports the capability.

The user should always be able to answer:

> **Why does Amble think this about me?**

Use small source markers such as CV, GitHub, Website, Interview and
Verified. Do not clutter every sentence with provenance.

## 18. Distinctive profile

A signature editorial section:

``` text
YOUR DISTINCTIVE PROFILE

AI infrastructure
        ×
Developer communities
        ×
Brand & growth
```

No Venn diagram. No radar chart. Typography and composition do the work.

It should be screenshot-worthy.

## 19. Evidence gaps

No warning styling.

``` text
THINGS I DON'T KNOW YET

Enterprise sales

You've worked around enterprise customers,
but I don't yet have enough evidence to
understand your direct role.

Strengthen this →
```

No red, orange warning icon or exclamation mark. Curiosity, not
deficiency.

Strengthen flow:

``` text
Help me understand this better.

○ Tell me about it
○ Add something you've worked on
○ Add a result
○ Connect another source
```

Never call it "Improve your score."

## 20. Intent

Give the main question space:

``` text
One more thing.

What would have to be true
for you to seriously consider
leaving your current job?

              ●
         Hold to talk

            or type
```

Then reveal interpretation progressively:

``` text
Here's what I'll listen for.

ROLE
CMO
Growth leadership

SPACE
AI
Developer tools
Infrastructure

COMPANY
Early stage
Strong technical founders

COMPENSATION
At least €X

OWNERSHIP
Meaningful equity
```

It should resemble a personal brief, not a form.

Values should be inline-editable where practical.

``` text
Does this represent you?

[ Yes, start listening ]

Something isn't right
```

## 21. Listening transition

After confirmation, briefly clear the screen.

Then:

``` text
Your Rep is listening.
```

A small moss dot appears and performs one subtle breath. Then the final
interface resolves.

No confetti, modal or fireworks. It should feel **calmly significant**.

## 22. Listening indicator

Canonical:

``` text
● LISTENING
```

The moss dot can breathe every 4--6 seconds:

``` text
scale 1 → 1.1 → 1
opacity .75 → 1 → .75
```

Barely noticeable. Respect `prefers-reduced-motion`.

## 23. Listening home

``` text
amble                                           ···

                         ● LISTENING

                 I'll only interrupt you
              when something deserves your
                       attention.

                CURRENTLY LISTENING FOR

                  AI infrastructure
                  Growth leadership
                     Early stage
                       Remote
                 Meaningful ownership

               Change what I'm listening for

────────────────────────────────────────────────────────────

Your Rep

38 pieces of evidence
11 capabilities

View your Professional Map →
```

Do not add charts, activity or recommendations to fill space.

Return state:

``` text
● LISTENING

Nothing worth bothering you with.

I'm still listening.
```

Never manufacture engagement.

## 24. Future opportunity pattern

``` text
Your Rep found something.

I think you should see this.
```

Inside:

``` text
I found something worth hearing.

Founding Infrastructure Engineer

Acme
Series A · Remote Europe

WHY I'M SHOWING YOU THIS

Your distributed systems work is
directly relevant.

The team and stage match what you
said you're looking for.

Compensation is within your range.

ONE THING TO CONSIDER

The infrastructure operates at a
smaller scale than your current work.

[ I'd hear them out ]

Not for me
```

If rejected, optionally ask what Amble should learn, without forcing
feedback.

## 25. Copy density and AI language

Most screens should contain surprisingly little text.

Prefer:

> I'll read it before asking you anything.

over AI-marketing explanations.

Avoid:

``` text
AI analysis
AI insights
AI-powered
Generate
Regenerate
AI score
AI assistant
Unlock your potential
Supercharge your career
Discover your dream job
```

Prefer:

``` text
Your Rep
I found
I noticed
I don't know yet
Here's what I understand
Let me look at that
```

The intelligence is embodied in the Rep.

## 26. Icons, loading, errors and success

Use icons only where they improve recognition. A quiet 1.5px
rounded-stroke style is preferred. Lucide is acceptable initially. No
sparkle icon for AI.

Avoid generic "Loading... / Processing... / Analyzing..." when truthful
meaningful language is possible:

``` text
Reading your CV...
Looking through your work...
Connecting the dots...
Checking something...
Building your map...
```

Errors should be plain and useful:

``` text
I couldn't read your GitHub profile.

Nothing has been lost.

Try again →
```

Routine success states are understated:

``` text
Got it.
Connected.
That's updated.
```

Preserve emotional weight for the Professional Map, feeling understood,
activating Listening and receiving a genuinely good opportunity.

## 27. Mobile and accessibility

Mobile is not compressed desktop.

Interview should work exceptionally well on mobile. Use 20px margins,
large tap targets, thumb-reachable recording control, linear editorial
Professional Map and bottom sheets for evidence.

Listening home should be beautiful at 390px.

Minimum accessibility:

-   WCAG AA contrast
-   keyboard navigation
-   visible focus
-   semantic HTML
-   ARIA labels where needed
-   44px practical touch targets
-   reduced motion
-   evidence states not encoded through colour alone
-   text alternative to voice
-   editable transcripts

Do not build dark mode in Sprint 01. The warm paper canvas is currently
part of the identity.

Suggested breakpoints:

``` css
--mobile: 640px;
--tablet: 768px;
--desktop: 1024px;
--wide: 1280px;
```

## 28. Motion

``` css
--motion-fast: 140ms;
--motion-default: 220ms;
--motion-slow: 380ms;

--ease-standard:
cubic-bezier(0.22, 1, 0.36, 1);
```

Major emotional transitions may occasionally use 500--700ms but must
never block interaction.

Avoid generic skeletons for intelligent processing; prefer meaningful
progressive disclosure.

## 29. Component inventory

Build only what v0.1 needs:

``` text
Button
TextButton
Input
Textarea
FileDrop
SourceRow
StatusDot
EvidenceState
EvidenceSource
CapabilityBlock
EvidenceDrawer
VoiceRecorder
TranscriptEditor
IntentItem
InlineEdit
QuietNotice
Header
Modal
BottomSheet
```

Do not build a giant design-system catalogue preemptively.

## 30. Avoid shadcn syndrome

Using Radix, shadcn or another primitive library is fine. Shipping its
visual defaults is not.

Do not produce generic card grids, default buttons everywhere, generic
dropdown styling, dashboard sidebars, rounded-xl everything, badge-heavy
interfaces, identical bordered containers or oversized hero gradients.

Primitives are implementation details. **Amble owns the visual
language.**

## 31. Signature details

Amble v0.1 should include at least five distinctly Amble interactions:

1.  **The listening breath** --- moss dot breathes almost imperceptibly.
2.  **Evidence arriving** --- processing discoveries settle into place
    one by one.
3.  **"I don't know yet"** --- evidence gaps appear without
    warning/error styling.
4.  **Interview transition** --- previous question quietly disappears
    before the next thought arrives.
5.  **Listening activation** --- onboarding ends not with celebration
    but with stillness: "Your Rep is listening."

These details matter more than another feature.

## 32. Screenshot test

Before accepting a screen, hide the Amble logo and ask:

> Could this be any random SaaS product?

If yes, it is not finished.

Then ask:

> Is anything here trying too hard to look designed?

If yes, simplify it.

Amble should be recognizable through restraint, typography, warmth and
interaction --- not decoration.

## 33. Desired emotional sequence

``` text
I gave it information.
        ↓
It actually read it.
        ↓
It asked surprisingly good questions.
        ↓
It understood things my CV doesn't show.
        ↓
It showed me something that feels like me.
        ↓
I told it what matters.
        ↓
Now I don't have to do anything.
```

That final transition is the entire Amble proposition.

## 34. Final design invariant

When choosing between **more information** and **more calm**, prefer
calm.

When choosing between **another control** and **Amble understanding
automatically**, prefer understanding.

When choosing between **showing that the AI is working** and **showing
what Amble understood**, prefer understanding.

When choosing between **engagement** and **not wasting the user's
time**, do not waste their time.

## 35. North Star

Amble should eventually become the rare piece of software where the
ideal interaction is:

**open it, feel understood, close it.**

Your Rep handles the rest.
