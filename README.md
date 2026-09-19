# Amble

Your professional Rep. You don't look for your next job — your Rep listens for you.

This repository contains the candidate-side vertical slice (Next.js 16, App Router, TypeScript) plus the **User Zero** pipeline: real source ingestion → claim extraction → evidence with provenance → capability assessment → uncertainty model → adaptive interview → Professional Map.

Two specs are the source of truth: [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) and [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

## Setup

```bash
npm install
copy .env.example .env.local   # (Windows) or: cp .env.example .env.local
# paste your key into AMBLE_MODEL_API_KEY, then:
npm run dev
```

Open http://localhost:3000. Building requires network access to `fonts.googleapis.com`, since `next/font` fetches Inter and Newsreader at build time.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `AMBLE_USER_ZERO` | `"true"` enables the real pipeline and completely disables all demo fixtures. |
| `AMBLE_MODEL_PROVIDER` | Provider kind. `openai-compatible` (default). |
| `AMBLE_MODEL_BASE_URL` | OpenAI-compatible endpoint base, including any version segment (e.g. `https://api.helmcode.com/v1`). |
| `AMBLE_MODEL_ID` | Exact model identifier. No default — set it explicitly. |
| `AMBLE_MODEL_API_KEY` | Server-side only. Never exposed to the browser. |
| `AMBLE_MODEL_JSON_MODE` | Send `response_format: json_object`. Default on. Must be **off** for `deepseek-v4-flash`. |
| `AMBLE_MODEL_REASONING` | Send `reasoning_effort`. Default off. On for `deepseek-v4-flash` only. |
| `AMBLE_MODEL_REASONING_EFFORT` | `low` / `medium` / `high`. Default depth for tasks with no preference of their own. |
| `AMBLE_MODEL_MAX_TOKENS` | Explicit output budget. A reasoning trace spends tokens before the JSON begins. |
| `AMBLE_MODEL_TIMEOUT_MS` | Request timeout. Default 120000; reasoning wants more. |
| `AMBLE_STT_BASE_URL` | Endpoint base for `/audio/transcriptions`. Defaults to `AMBLE_MODEL_BASE_URL`. |
| `AMBLE_STT_MODEL` | Transcription model (`whisper`). Unset disables voice and leaves the text box. |
| `AMBLE_STT_API_KEY` | Optional. Falls back to `AMBLE_MODEL_API_KEY`. |
| `AMBLE_STT_LANGUAGE` | ISO-639-1 hint (`es`, `en`). Empty auto-detects. |
| `AMBLE_SMTP_HOST` | Mail server for the one message. Empty means nothing is sent, and the outbox says so rather than pretending. |
| `AMBLE_SMTP_PORT` | 587 (STARTTLS) or 465 (TLS from the first byte). Default 587. |
| `AMBLE_SMTP_USER` / `AMBLE_SMTP_PASSWORD` | Both empty means no AUTH at all. |
| `AMBLE_SMTP_FROM` / `AMBLE_SMTP_FROM_NAME` | What the message says it is from. Falls back to the user. |
| `AMBLE_SMTP_IMPLICIT_TLS` | Force TLS from the first byte. Defaults to on for port 465. |
| `AMBLE_BASE_URL` | Where the message tells them to go to answer. |

Without `AMBLE_MODEL_API_KEY` / `AMBLE_MODEL_ID` the pipeline fails honestly with a 503 — it never falls back to demo data.

### Picking a model

Every task returns JSON and is validated against a Zod schema. Two server features affect that, and no model on Helmcode supports both:

| | `response_format` | `reasoning_effort` |
| --- | --- | --- |
| `deepseek-v4-flash` | no | yes |
| `qwen3.6`, `gemma4` | yes | via `chat_template_kwargs.enable_thinking` |

Amble runs on `deepseek-v4-flash` because capability assessment is a judgement about what evidence proves, and that is worth real reasoning. Losing server-enforced JSON costs little: the prompts demand JSON, the parser pulls the object out of prose, code fences or thinking blocks, and Zod rejects whatever does not fit. A failed parse is retried once with the validation error fed back in.

Tasks declare their own depth. Judging evidence and planning the next question ask for `high`; extracting claims from a document asks for `low`, since it is transcription rather than thought.

Swapping models means swapping both flags:

```ini
# deepseek-v4-flash
AMBLE_MODEL_JSON_MODE=off
AMBLE_MODEL_REASONING=on

# qwen3.6 / gemma4
AMBLE_MODEL_JSON_MODE=on
AMBLE_MODEL_REASONING=off
```

Every call is recorded in `model_runs` with its latency, raw output and reasoning trace, so `/dev/user-zero` shows what a model swap actually changed.

## Modes

- **User Zero** (`AMBLE_USER_ZERO=true`): no seeded profile, no seeded questions, no hidden fixtures. Sources are read for real; every claim carries provenance; the interview is planned from open uncertainties.
- **Fixture mode** (flag off): the original demo journey with the Borja fixture profile, for design iteration and demos.

## Developer trace

With the flag active and `next dev` running:

- **http://localhost:3000/dev/user-zero** — the full graph trace: sources, claims, evidence, capabilities, uncertainties, interview turns, model runs and evaluations.
- **http://localhost:3000/dev/opportunity-zero** — the opportunity lab. Label an opportunity before running it, then read what Amble did with it: the rubric, the four readings, what the model proposed, what the rules decided, and the audit trail. The label is written to its own table and nothing that builds a prompt reads it.

Local data lives in `.amble-data/` (SQLite + uploaded sources). Delete the folder to reset the experiment.

## Where opportunities come from

Two ways in, both landing in the same table and read by the same pipeline.

**By hand**, pasted into the lab at `/dev/opportunity-zero`, which is how the ten calibration fixtures are run.

**From Manfred**, via `POST /api/sources/manfred` or the button in the lab. Manfred publishes `sitemap-offers.xml` and allows everything in `robots.txt`, and each offer page carries the whole posting as JSON — salary, remote share, locations, requirements. No key and no private endpoint is touched. The sync reads one page at a time with a pause between them, never re-fetches an offer it already stored, and identifies itself in the User-Agent.

What the feed states as numbers is checked in code before anything reaches a model: an offer paying under the floor, or asking for more presence than the candidate will give, is stored with the reason and never costs a call. With ~1,600 offers in the sitemap and about a minute of reasoning each, that screen is the difference between a click and a day of compute. Whatever survives it is capped by `maxEvaluations` per run.

## What gets sent

Only an interruption is sent anywhere — never a HOLD, never a digest. The message is written to an outbox table the moment the decision exists, then delivered by the same queue that runs everything else, with the same backoff. It says exactly what the listening screen says, because two versions of why somebody is being interrupted is two products.

SMTP is spoken directly over `node:tls` (no dependency). With no mail server configured the message is still written and the outbox reads `unconfigured`: silence by accident and silence on purpose must not look the same.

## Tests and measurement

```bash
npm test                      # node --test, no network and no real database
npm run measure -- <cv.pdf>   # one full User Zero session over HTTP, timed
npm run measure:opportunities # the ten opportunity fixtures, with next dev running
npm run reset:opportunities   # clear the opportunities, keep the graph
```

No test framework: Node 22 strips the types itself, and `scripts/test-resolve.mjs` resolves the `@/` alias and extensionless imports. Domain rules are tested with no database and no provider; the pipeline tests build a throwaway database in a temp directory and stub the four model calls.

The measurement scripts are the opposite: they drive the real HTTP routes against a running dev server and a real model, and write their full transcript to `.amble-data/`.
