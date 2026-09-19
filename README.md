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
| `AMBLE_TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Empty means nothing is sent there. |
| `AMBLE_BASE_URL` | Where the message tells them to go to answer. |
| `AMBLE_SOURCE_SYNC_HOURS` | How often to look for new offers on its own. Empty or 0 means only when asked. |
| `AMBLE_ATS_BOARDS` | Company boards to read, e.g. `greenhouse:vercel,ashby:posthog`. |
| `AMBLE_ATS_DEPARTMENTS` | Keep only what those boards file under one of these. Empty keeps everything. |

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

**From Manfred**, via `POST /api/sources/manfred` or the button in the lab. It uses Manfred's own public API — the one their offers page calls:

```
GET /api/v2/public/offers?onlyActive=true&lang=ES   every live offer (~17)
GET /api/v2/public/offers/{id}?lang=ES              one, in full
```

No key and nothing private. The shape of that first call shapes the whole sync: one request returns every live offer with what it pays, how much of it is on site and where — all of which the domain can check for free. So the screening runs on the list, and an offer that pays under the floor is stored with the reason without being downloaded at all. Only survivors are fetched in full, one at a time with a pause, and an offer already stored is never fetched again.

In practice that is 13 of 17 dropped for nothing and 4 downloaded. With about a minute of reasoning per offer, that screen is the difference between a click and a long afternoon. Whatever survives is capped by `maxEvaluations` per run.

**From company boards.** `POST /api/sources/ats` reads the applicant tracking systems startups actually post to, which serve the same data as public JSON because that is how their embedded boards work:

```
GET boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true
GET api.ashbyhq.com/posting-api/job-board/{company}?includeCompensation=true
```

One request per company, posting included, so there is no second round trip at all. Which companies is a list in `AMBLE_ATS_BOARDS`, not a crawl: Amble is not trying to see every job in the world, it is watching the handful of places one person would actually go.

Neither board states pay reliably and Greenhouse gives location as free text ("Hybrid - London"), so the free screen has almost nothing to work with there — and the adapter leaves those fields null rather than reading a hard constraint out of a string somebody typed. The triage instead is `AMBLE_ATS_DEPARTMENTS`, matched against the board's own department. In practice Vercel's 84 jobs become 10 and PostHog's 9 become 1.

Set `AMBLE_SOURCE_SYNC_HOURS` and it goes on its own. There is no cron daemon: the queue already runs things later and survives restarts, so the sync puts the next one on the queue before it finishes, and the endpoints the screens poll put it back if it ever went missing. It runs while the server does.

## When the Rep asks you something

A hold says what would resolve it. Until recently that was a dead end: the question sat in a column and nothing carried it anywhere, and five holds out of five were addressed to the company — somebody Amble cannot reach.

Now, when the gap holding a decision up is about the person rather than about the job, the Rep asks them. The question goes out through the same outbox as an interruption and appears on the listening screen with much less weight than one. The answer is stored immediately, then read into the graph by the same path an interview answer takes — a claim with provenance, evidence, capabilities reassessed — and the opportunity is evaluated again. The posting has not changed, so its rubric is not paid for twice.

It is deliberately the smallest version of something larger: a question leaves, an answer comes back, the graph changes, the decision is taken again. Putting an agent at the far end instead of a person changes the recipient, not the machinery.

## What gets sent

Only an interruption is sent anywhere — never a HOLD, never a digest. The message is written to an outbox table the moment the decision exists, then delivered by the same queue that runs everything else, with the same backoff. It says exactly what the listening screen says, because two versions of why somebody is being interrupted is two products.

Three channels, picked on the listening screen. **Telegram** gets the whole thing — headline, why it is being shown, the evidence behind each claim, what is still unknown — because it has no templates and no approvals: a bot token is the entire setup (`npm run telegram:whoami` finds your chat id). **Email** gets the same text over SMTP, spoken directly over `node:tls` with no dependency. **WhatsApp** is offered and does not work yet, and says so on the screen: Meta will not let a business start a conversation without a template approved in advance, so the message there could only ever be a line and a link, and the explanation is the product.

With a channel picked but nothing configured behind it, the message is still written and the outbox reads `unconfigured`: silence by accident and silence on purpose must not look the same.

## Tests and measurement

```bash
npm test                      # node --test, no network and no real database
npm run measure -- <cv.pdf>   # one full User Zero session over HTTP, timed
npm run measure:opportunities # the ten calibration fixtures, with next dev running
npm run measure:gaps          # the eight gap fixtures
npm run reset:opportunities   # clear the opportunities, keep the graph
npm run telegram:whoami       # which chat id is yours
```

Two fixture sets, measured apart. **Calibration** is ten different ways of being nearly right, and its numbers are the two errors that matter: NO × INTERRUPT is noise, YES × IGNORE is a miss. **Gaps** is eight offers that all fit, each missing or contradicting exactly one thing, and its number is whether a hold asks the one right question. Averaging them together would hide both.

No test framework: Node 22 strips the types itself, and `scripts/test-resolve.mjs` resolves the `@/` alias and extensionless imports. Domain rules are tested with no database and no provider; the pipeline tests build a throwaway database in a temp directory and stub the four model calls.

The measurement scripts are the opposite: they drive the real HTTP routes against a running dev server and a real model, and write their full transcript to `.amble-data/`.
