// npm run eval:agent: the chat agent (src/lib/whatsapp/agent.ts) asked the
// conversations testers had with it, or would have, with its real prompt,
// schema and model path (askAgent → runStructuredTask), each against a small
// made-up WHAT YOU KNOW (BASE below, changed by each case). It prints what
// passed and what did not, and why.
//
// It calls the model, so it is not part of npm test, and it runs only with a
// key of its own (DEVELOPMENT.md, rule 8):
//   AMBLE_EVAL_MODEL_KEY       the key, never production's (refused if it is the same)
//   AMBLE_EVAL_MODEL_ID        the model (else AMBLE_MODEL_ID)
//   AMBLE_EVAL_MODEL_BASE_URL  the provider (else AMBLE_MODEL_BASE_URL, else the default)
// What it records (each model run) goes to a temp database, never .amble-data/.
//
//   npm run eval:agent                 every case in evals/agent/*.json
//   npm run eval:agent -- 52 44        only cases whose id or file has that in it
//   npm run eval:agent -- --replies    every reply printed, not only the failed ones
//
// A case (evals/agent/<issue>.json, { issue, feedback, cases: [...] }):
//   id, message, context (merged over BASE: objects merge, arrays replace),
//   expect: { intent, action (a type, null, or a list of them), actionHas,
//             preference, forward, answersInterview, reasonItDoesNotFit,
//             reminders (at least), replyIncludes (all), replyIncludesAny },
//   forbid: words or /regex/flags the reply must not have,
//   allow: checks every case has that this one skips ("percent", "internal",
//          "gender", "links").
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentContext } from '../src/lib/whatsapp/agent'
import { APP, base, check, merge, type EvalFile, type Json } from './eval-agent-checks'

function refuse(message: string): never {
  console.error(`eval:agent: ${message}`)
  process.exit(2)
}

function setUpEnvironment() {
  const key = process.env.AMBLE_EVAL_MODEL_KEY?.trim()
  if (!key) {
    refuse(
      'needs AMBLE_EVAL_MODEL_KEY, a model key of its own (DEVELOPMENT.md, rule 8: model calls in tests never use production\'s key). Set it, and AMBLE_EVAL_MODEL_ID if AMBLE_MODEL_ID is not set.',
    )
  }
  const production = [process.env.AMBLE_MODEL_API_KEY, ...(process.env.AMBLE_MODEL_API_KEYS ?? '').split(',')].map((value) => value?.trim()).filter(Boolean)
  if (production.includes(key)) refuse('AMBLE_EVAL_MODEL_KEY is the same key as AMBLE_MODEL_API_KEY(S): use a key of its own.')
  const modelId = process.env.AMBLE_EVAL_MODEL_ID?.trim() || process.env.AMBLE_MODEL_ID?.trim()
  if (!modelId) refuse('needs AMBLE_EVAL_MODEL_ID (or AMBLE_MODEL_ID): the model to ask.')
  // The model path reads these: only the eval's key, and nothing that reaches anyone.
  process.env.AMBLE_MODEL_API_KEY = key
  delete process.env.AMBLE_MODEL_API_KEYS
  process.env.AMBLE_MODEL_ID = modelId
  if (process.env.AMBLE_EVAL_MODEL_BASE_URL?.trim()) process.env.AMBLE_MODEL_BASE_URL = process.env.AMBLE_EVAL_MODEL_BASE_URL.trim()
  for (const name of Object.keys(process.env)) if (/^(ZERNIO_|TELEGRAM_|RESEND_|BROWSERBASE_|AMBLE_THEIRSTACK_)/.test(name)) delete process.env[name]
  process.env.AMBLE_APP_URL = APP
  process.env.AMBLE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-eval-'))
}

function cell(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat.padEnd(width)
}

async function main() {
  const args = process.argv.slice(2)
  const showReplies = args.includes('--replies')
  const only = args.filter((arg) => !arg.startsWith('--'))
  setUpEnvironment()
  // Only now: the model path reads its keys when it loads.
  const { askAgent, languageOf, promisesWithoutKeeping, AGENT_VERSION } = await import('../src/lib/whatsapp/agent')
  const { appPagesAt } = await import('../src/lib/whatsapp/capabilities')
  const appPages = appPagesAt(APP)

  const folder = path.join(__dirname, '..', 'evals', 'agent')
  const cases = fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const file = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as EvalFile
      return file.cases.map((item) => ({ ...item, file: name }))
    })
    .filter((item) => only.length === 0 || only.some((part) => item.id.includes(part) || item.file.includes(part)))
  if (cases.length === 0) refuse('no case matches.')
  const ids = cases.map((item) => item.id)
  if (new Set(ids).size !== ids.length) refuse(`a case id twice: ${ids.filter((id, index) => ids.indexOf(id) !== index).join(', ')}`)

  const today = `${new Date().toISOString().slice(0, 10)} (${new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(new Date())})`
  console.log(`Agent ${AGENT_VERSION}, model ${process.env.AMBLE_MODEL_ID}, ${cases.length} cases\n`)

  const results: { id: string; ok: boolean; intent: string; action: string; wrong: string[]; reply: string }[] = []
  // A few at a time: the provider limits calls in flight per key.
  const queue = [...cases]
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const context = merge(base(today, appPages) as unknown as Json, item.context ?? {}) as unknown as AgentContext
      try {
        const answer = await askAgent(null, context, item.message, languageOf(item.message))
        const wrong = check(item, answer, context, promisesWithoutKeeping)
        results.push({ id: item.id, ok: wrong.length === 0, intent: answer.intent, action: answer.action ? JSON.stringify(answer.action) : '-', wrong, reply: answer.reply })
      } catch (error) {
        results.push({ id: item.id, ok: false, intent: '-', action: '-', wrong: [`no answer: ${error instanceof Error ? error.message : String(error)}`], reply: '' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, cases.length) }, worker))
  results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))

  console.log(`${cell('case', 30)} ${cell('', 4)} ${cell('intent', 12)} ${cell('action', 34)} why`)
  for (const result of results) {
    console.log(`${cell(result.id, 30)} ${cell(result.ok ? 'ok' : 'FAIL', 4)} ${cell(result.intent, 12)} ${cell(result.action, 34)} ${result.wrong.join('; ')}`)
  }
  const failed = results.filter((result) => !result.ok)
  for (const result of showReplies ? results : failed) console.log(`\n${result.id}${result.ok ? '' : ' (FAIL)'}:\n${result.reply}`)
  console.log(`\n${results.length - failed.length} of ${results.length} passed`)
  process.exit(failed.length > 0 ? 1 : 0)
}

void main()
