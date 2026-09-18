/**
 * One full User Zero run, driven through the HTTP API, timed.
 *
 *   npm run measure -- <path-to-cv.pdf>
 *
 * The answers are written by the model itself, playing the person in the CV.
 * They are synthetic: good enough to judge rhythm, repetition and how many
 * uncertainties survive the first pass, not to judge the quality of what
 * Amble learns about a real person.
 */

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const BASE = process.env.AMBLE_MEASURE_BASE ?? 'http://localhost:3000'
const cvPath = process.argv[2]
const MAX_TURNS = Number.parseInt(process.env.AMBLE_MEASURE_MAX_TURNS ?? '', 10) || 10

if (!cvPath || !fs.existsSync(cvPath)) {
  console.error('Usage: node --env-file=.env.local scripts/measure-run.mjs <path-to-cv.pdf>')
  process.exit(1)
}

const modelBase = (process.env.AMBLE_MODEL_BASE_URL ?? '').replace(/\/+$/, '')
const modelId = process.env.AMBLE_MODEL_ID ?? ''
const modelKey = process.env.AMBLE_MODEL_API_KEY ?? ''

const s = (ms) => `${(ms / 1000).toFixed(1)}s`
const now = () => Date.now()

async function api(pathname, init) {
  const response = await fetch(`${BASE}${pathname}`, init)
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    /* an HTML error page, most likely */
  }
  if (!response.ok) {
    throw new Error(`${pathname} -> HTTP ${response.status}: ${body?.error ?? text.slice(0, 200)}`)
  }
  return body
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/onboarding/sources`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`No dev server answering at ${BASE}. Run npm run dev first.`)
}

/**
 * Ask for the next question, waiting out WAIT the way the browser does. The
 * server plans on a queue and never blocks the request, so the waiting is
 * here.
 */
async function nextQuestion(timeoutMs = 300_000) {
  const startedAt = now()
  let retried = false
  for (;;) {
    const plan = await api('/api/interview/next', { method: 'POST' })
    if (plan.action !== 'WAIT') return { plan, waitedMs: now() - startedAt, retried }
    if (plan.retrying && !retried) {
      retried = true
      console.log('    (the server is retrying after a failure — waiting it out)')
    }
    if (now() - startedAt > timeoutMs) {
      throw new Error(`Still waiting for a question after ${Math.round(timeoutMs / 1000)}s`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

/** The candidate, played by the same model the pipeline uses. */
async function answerAs(cvText, question, alreadyAsked) {
  const messages = [
    {
      role: 'system',
      content:
        'You are the person described in the CV below. Answer interview questions in first person, ' +
        'the way you would speak: 2 to 4 sentences, concrete, with real numbers where the CV supports ' +
        'them. Where you would not know, say so plainly rather than inventing. No preamble, no bullet ' +
        `points, just the answer.\n\nCV:\n${cvText}`,
    },
    ...(alreadyAsked.length
      ? [
          {
            role: 'system',
            content: `You have already been asked, and answered: ${alreadyAsked.map((q) => `"${q}"`).join(' ')}`,
          },
        ]
      : []),
    { role: 'user', content: question },
  ]

  // The endpoint drops a connection now and then. A run that dies on turn two
  // has measured nothing, so retry rather than lose the session.
  let lastError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${modelBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modelKey}` },
        body: JSON.stringify({ model: modelId, messages, temperature: 0.7, max_tokens: 600 }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      const content = (body?.choices?.[0]?.message?.content ?? '').trim()
      if (!content) throw new Error('empty completion')
      return content
    } catch (error) {
      lastError = error
      console.log(`    (answer generation failed: ${error.message} — retry ${attempt} of 3)`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
  throw new Error(`Answer generation failed after 4 attempts: ${lastError?.message}`)
}

function counts() {
  const db = new DatabaseSync(path.join(process.cwd(), '.amble-data', 'amble.db'), { readOnly: true })
  const one = (sql) => db.prepare(sql).get()?.n ?? 0
  const result = {
    claims: one('SELECT COUNT(*) AS n FROM claims'),
    evidence: one('SELECT COUNT(*) AS n FROM evidence'),
    capabilities: one('SELECT COUNT(*) AS n FROM capabilities'),
    uncertainties: one('SELECT COUNT(*) AS n FROM uncertainties'),
    uncertaintiesOpen: one("SELECT COUNT(*) AS n FROM uncertainties WHERE status = 'OPEN'"),
    turnsAnswered: one('SELECT COUNT(*) AS n FROM interview_turns WHERE answer IS NOT NULL'),
    modelCalls: one('SELECT COUNT(*) AS n FROM model_runs'),
    modelFailures: one('SELECT COUNT(*) AS n FROM model_runs WHERE ok = 0'),
  }
  result.byTask = db
    .prepare(
      `SELECT task, COUNT(*) AS calls, SUM(ok = 0) AS failures,
              ROUND(AVG(latency_ms)) AS avg_ms, MAX(latency_ms) AS max_ms
       FROM model_runs GROUP BY task ORDER BY SUM(latency_ms) DESC`,
    )
    .all()
  db.close()
  return result
}

await waitForServer()
console.log(`server    ${BASE}`)
console.log(`cv        ${cvPath}`)
console.log(`model     ${modelId}`)
console.log()

const sidecar = cvPath.replace(/\.pdf$/i, '.txt')
const cvText = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, 'utf8') : ''

// -- Ingest ------------------------------------------------------------
const form = new FormData()
form.append('file', new File([fs.readFileSync(cvPath)], path.basename(cvPath), { type: 'application/pdf' }))
const uploadStarted = now()
const source = await api('/api/onboarding/sources', { method: 'POST', body: form })
console.log(`upload                 ${s(now() - uploadStarted)}  ${JSON.stringify(source).slice(0, 140)}`)

// Reading runs on the queue now: this starts it and then watches, the same
// way the browser does.
const processingStarted = now()
const started = await api('/api/onboarding/process', { method: 'POST' })
console.log(`start processing       ${s(now() - processingStarted)}  ${started.started.length} source(s) queued`)

const stages = []
let lastPhase = null
let processingState = null
for (;;) {
  processingState = await api('/api/onboarding/state')
  if (processingState.phase !== lastPhase) {
    lastPhase = processingState.phase
    stages.push({ stage: lastPhase, at: now() - processingStarted })
    console.log(`  ${s(now() - processingStarted).padStart(6)}  ${lastPhase}`)
  }
  if (processingState.phase === 'done') break
  if (processingState.phase === 'failed') {
    throw new Error(`Processing failed: ${processingState.error}`)
  }
  if (now() - processingStarted > 900_000) throw new Error('Processing never finished')
  await new Promise((resolve) => setTimeout(resolve, 1200))
}
const ingestElapsed = now() - processingStarted
console.log(
  `processing done        ${s(ingestElapsed)}  ${JSON.stringify(processingState.counts)}`,
)

// -- Interview ---------------------------------------------------------
console.log()
const first = await nextQuestion()
let plan = first.plan
const timeToFirst = first.waitedMs
console.log(`first question         ${s(timeToFirst)}`)

const turns = []
const askedQuestions = []

while (plan?.action === 'ASK' && turns.length < MAX_TURNS) {
  const question = plan.question
  const repeatOf = askedQuestions.findIndex((asked) => asked === question)
  askedQuestions.push(question)
  console.log()
  console.log(`Q${turns.length + 1}  ${question}`)
  if (repeatOf !== -1) console.log(`    !! word for word the same as Q${repeatOf + 1}`)

  const answer = await answerAs(cvText, question, askedQuestions.slice(0, -1))
  console.log(`A${turns.length + 1}  ${answer.replace(/\s+/g, ' ').slice(0, 200)}`)

  const sentAt = now()
  const saved = await api('/api/interview/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnId: plan.turnId, answer }),
  })
  const saveMs = now() - sentAt

  const prefetched = Boolean(saved.next)
  let waitMs = saveMs
  if (saved.next) {
    plan = saved.next
  } else {
    const waited = await nextQuestion()
    plan = waited.plan
    waitMs = saveMs + waited.waitedMs
  }

  turns.push({
    question,
    answer,
    saveMs,
    waitMs,
    prefetched,
    repeatOf: repeatOf === -1 ? null : repeatOf + 1,
    progress: saved.progress ?? null,
  })
  console.log(
    `    saved in ${s(saveMs)} | next question ${prefetched ? 'was already waiting' : 'had to be planned'} | ${s(waitMs)} until it was on screen`,
  )
}

// -- Report ------------------------------------------------------------
const waits = turns.map((turn) => turn.waitMs)
const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0
const ingestMs = ingestElapsed
const db = counts()

console.log()
console.log('-- Run ----------------------------------------------')
console.log(`Ingest to first question   ${s(ingestMs + timeToFirst)}`)
console.log(`  of which first question  ${s(timeToFirst)}`)
const repeats = turns.filter((turn) => turn.repeatOf !== null).length
console.log(`Verbatim repeats           ${repeats}`)
console.log(`Questions asked            ${turns.length}${plan?.action === 'STOP' ? ' (the Rep stopped)' : ' (hit the cap)'}`)
if (waits.length) {
  console.log(`Answer to next question    avg ${s(avg)} | worst ${s(Math.max(...waits))} | best ${s(Math.min(...waits))}`)
  console.log(`  already waiting          ${turns.filter((turn) => turn.prefetched).length} of ${turns.length}`)
}
console.log()
console.log(`Claims                     ${db.claims}`)
console.log(`Evidence                   ${db.evidence}`)
console.log(`Capabilities               ${db.capabilities}`)
console.log(`Uncertainties              ${db.uncertainties} created | ${db.uncertaintiesOpen} still open`)
console.log(`Model calls                ${db.modelCalls}${db.modelFailures ? ` | ${db.modelFailures} failed` : ' | none failed'}`)
console.log()
console.log('task                        calls  fail     avg   worst')
for (const row of db.byTask) {
  console.log(
    `${String(row.task).padEnd(26)}  ${String(row.calls).padStart(5)}  ${String(row.failures ?? 0).padStart(4)}  ${s(row.avg_ms ?? 0).padStart(6)}  ${s(row.max_ms ?? 0).padStart(6)}`,
  )
}

fs.writeFileSync(
  path.join(process.cwd(), '.amble-data', 'measure-run.json'),
  JSON.stringify({ at: new Date().toISOString(), stages, timeToFirst, turns, db }, null, 2),
)
console.log()
console.log('Full transcript and timings: .amble-data/measure-run.json')
