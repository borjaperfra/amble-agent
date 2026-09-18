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

With the flag active and `next dev` running: **http://localhost:3000/dev/user-zero** shows the full graph trace — sources, claims, evidence, capabilities, uncertainties, interview turns, model runs and evaluations.

Local data lives in `.amble-data/` (SQLite + uploaded sources). Delete the folder to reset the experiment.
