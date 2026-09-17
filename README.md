# Amble

Your professional Rep. You don't look for your next job — your Rep listens for you.

This repository contains the candidate-side vertical slice (Next.js 16, App Router, TypeScript) plus the **User Zero** pipeline: real source ingestion → claim extraction → evidence with provenance → capability assessment → uncertainty model → adaptive interview → Professional Map.

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
| `AMBLE_USER_ZERO` | `"true"` enables the real pipeline and completely disables all demo fixtures. |
| `AMBLE_MODEL_PROVIDER` | Provider kind. `openai-compatible` (default). |
| `AMBLE_MODEL_BASE_URL` | OpenAI-compatible endpoint base (e.g. `https://api.deepseek.com`). |
| `AMBLE_MODEL_ID` | Exact model identifier. No default — set it explicitly. |
| `AMBLE_MODEL_API_KEY` | Server-side only. Never exposed to the browser. |

Without `AMBLE_MODEL_API_KEY` / `AMBLE_MODEL_ID` the pipeline fails honestly with a 503 — it never falls back to demo data.

## Modes

- **User Zero** (`AMBLE_USER_ZERO=true`): no seeded profile, no seeded questions, no hidden fixtures. Sources are read for real; every claim carries provenance; the interview is planned from open uncertainties.
- **Fixture mode** (flag off): the original demo journey with the Borja fixture profile, for design iteration and demos.

## Developer trace

With the flag active and `next dev` running: **http://localhost:3000/dev/user-zero** shows the full graph trace — sources, claims, evidence, capabilities, uncertainties, interview turns, model runs and evaluations.

Local data lives in `.amble-data/` (SQLite + uploaded sources). Delete the folder to reset the experiment.
