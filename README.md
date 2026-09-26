# Amble

Your professional Rep. You don't look for your next job — your Rep listens for you.

This repository contains the candidate side (Next.js 16, App Router, TypeScript): real source ingestion → claim extraction → evidence with provenance and attribution → capability assessment → uncertainty model → adaptive interview with defence questions → Professional Map, plus revealed intent through offer triage, what the Rep listens for, and a generated `career.md`.

Two specs are the source of truth: [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) and [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

## Setup

```bash
npm install
copy .env.example .env.local   # (Windows) or: cp .env.example .env.local
# fill in the model variables, then:
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `AMBLE_MODEL_PROVIDER` | Provider kind. `openai-compatible` (default). |
| `AMBLE_MODEL_BASE_URL` | OpenAI-compatible endpoint base (e.g. `https://api.deepseek.com`). |
| `AMBLE_MODEL_ID` | Exact model identifier. No default — set it explicitly. |
| `AMBLE_MODEL_API_KEY` | Server-side only. Never exposed to the browser. |
| `AMBLE_GITHUB_TOKEN` | Optional. Raises the GitHub read limit from 60 to 5,000 requests/hour. |
| `AMBLE_THEIRSTACK_API_KEY` | Optional. TheirStack job search, the route to offers posted on LinkedIn and Indeed. Free tier: 200 offers a month. |

Without `AMBLE_MODEL_API_KEY` / `AMBLE_MODEL_ID` the pipeline fails honestly with a 503. There is no demo data to fall back to: every screen runs on real sources and real answers.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run career:example` | Renders `src/fixtures/career.example.md` from a fictional candidate, through the product's renderer. |
| `npm run career:example:check` | Fails if the renderer's output has drifted from that example. The regression test for `career.md`. |
| `npx tsx scripts/import-triage.ts <file>` | Imports a triage run outside the product (offers and literal answers). Keep such files in `.amble-data/`. |
| `npm run sourcing -- watch "Company" [careers-url]` | Finds the company's public job board (Greenhouse, Lever, Ashby, Workable) and watches it. |
| `npm run sourcing -- run` | Reads every watched board: new offers are stored, missing ones are closed. Meant to be scheduled. |
| `npm run sourcing -- status` | Watched companies, their boards and offer counts. |

## Developer trace

With `next dev` running: **http://localhost:3000/dev/trace** shows the full graph trace — sources, claims, evidence, capabilities, uncertainties, interview turns, model runs and evaluations. It is not served in production.

Local data lives in `.amble-data/` (SQLite + uploaded sources). Delete the folder to reset the experiment.
