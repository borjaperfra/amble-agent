// npm run try:cv-review: «Tu CV, mejor» (#55) once against the real model, for
// a made-up person (Marta, DevRel) and ten made-up offers, in a temp database.
// Uses the eval's key and rules (scripts/eval-agent.ts, DEVELOPMENT.md rule 8):
// never during a listening pass when the key is production's.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function refuse(message: string): never {
  console.error(`try:cv-review: ${message}`)
  process.exit(2)
}

const key = process.env.AMBLE_EVAL_MODEL_KEY?.trim()
if (!key) refuse('needs AMBLE_EVAL_MODEL_KEY (see scripts/eval-agent.ts).')
const production = [process.env.AMBLE_MODEL_API_KEY, ...(process.env.AMBLE_MODEL_API_KEYS ?? '').split(',')].map((value) => value?.trim()).filter(Boolean)
if (production.includes(key) || process.env.AMBLE_EVAL_SHARED_KEY === '1') {
  if (process.env.AMBLE_EVAL_SHARED_KEY !== '1') refuse('that key is production’s: set AMBLE_EVAL_SHARED_KEY=1.')
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  if ([8, 12, 16, 20].includes(hour)) refuse(`it is ${hour}:xx in Madrid, a listening pass.`)
}
process.env.AMBLE_MODEL_API_KEY = key
delete process.env.AMBLE_MODEL_API_KEYS
if (process.env.AMBLE_EVAL_MODEL_ID?.trim()) process.env.AMBLE_MODEL_ID = process.env.AMBLE_EVAL_MODEL_ID.trim()
for (const name of Object.keys(process.env)) if (/^(ZERNIO_|TELEGRAM_|RESEND_|BROWSERBASE_|AMBLE_THEIRSTACK_)/.test(name)) delete process.env[name]
process.env.AMBLE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amble-cv-'))

const CV = `[page 1]
Marta Quiroga Lez
marta@correo.example · Madrid
Developer Relations Lead, Farolillo Labs (2024 - hoy)
Responsable de la comunidad de desarrolladores de la plataforma.
Escribo contenido técnico y doy charlas.
Developer Advocate, Nube Clara
Experiencia en cloud y contenedores.
Organicé meetups.
[page 2]
Formación: Ingeniería Informática, UPM (2015)`

const EVIDENCE: [string, string, boolean][] = [
  ['Lidera un equipo de 4 personas de DevRel en Farolillo Labs', 'interview', false],
  ['Lanzó un programa de embajadores que pasó de 0 a 120 miembros en un año', 'interview', false],
  ['Mantiene una CLI open source (farol-cli) con 1.400 estrellas en GitHub', 'github', false],
  ['Escribe en Go y TypeScript', 'github', false],
  ['Trabajó con Kubernetes y Terraform en Nube Clara', 'linkedin', false],
  ['Dio 14 charlas en conferencias en 2025, entre ellas KubeCon Europe', 'website', false],
  ['Developer Advocate en Nube Clara de 2019 a 2023', 'linkedin', false],
  ['Responsable de la comunidad de desarrolladores de Farolillo Labs', 'cv', true],
  ['Escribe contenido técnico y da charlas', 'cv', true],
  ['Organizó meetups', 'cv', true],
]

const OFFERS: [string, string, string][] = [
  ['Pigment', 'Head of Developer Relations', 'Lead and grow a team of developer advocates. You have managed people before. Own our developer community strategy and ambassador program. Speak at conferences. Experience with Kubernetes is a plus. Measure community growth with clear metrics.'],
  ['Factorial', 'DevRel Lead', 'You will manage a small team of 3 advocates, build our API community, write technical content and tutorials, and present at events. You know TypeScript. You have run a community or ambassador program and can show its growth. SQL to track adoption metrics.'],
  ['Cabify', 'Developer Advocate Manager', 'People management experience required. Grow our open source presence: experience maintaining an open source project is valued. Public speaking at international conferences. Familiar with Go. Data-driven: SQL and dashboards.'],
  ['Typeform', 'Senior Developer Advocate', 'Create technical content, demos and sample apps in TypeScript. Speak at meetups and conferences. Run community programs. Experience with cloud platforms (AWS or GCP) and Terraform.'],
  ['Glovo', 'Community Lead, Developers', 'Build and lead a developer community from scratch, launch an ambassador program, organize meetups. Manage budgets. SQL for community analytics.'],
  ['Travelperk', 'Developer Experience Lead', 'Lead a team improving docs, SDKs and CLI tools. Experience building or maintaining a CLI. Go or TypeScript. Kubernetes knowledge.'],
  ['Wallapop', 'DevRel Manager', 'Manage developer advocates, define DevRel KPIs, speak at conferences such as KubeCon. Open source contribution. Terraform and cloud.'],
  ['Red Points', 'Developer Relations Lead', 'Lead DevRel with a team of 2. Own content, events and the ambassador program. Report growth with numbers.'],
  ['Seedtag', 'Developer Advocate', 'Write tutorials, speak at events, gather product feedback from developers. Python or TypeScript. Kubernetes a plus.'],
  ['Holded', 'Head of Community', 'Lead the community team, grow the developer and partner community, launch programs and measure them. Stakeholder management. SQL.'],
]

async function main() {
  const { getDb, DATA_DIRECTORY } = await import('../src/lib/db/db')
  const { buildCvReview } = await import('../src/lib/career/cv-review')
  const db = getDb()
  const at = new Date(Date.now() - 86_400_000).toISOString()
  db.prepare("INSERT INTO candidates (id, name, created_at, locale) VALUES ('marta', 'Marta', ?, 'es')").run(at)
  fs.mkdirSync(path.join(DATA_DIRECTORY, 'uploads'), { recursive: true })
  fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', 'cv1.txt'), CV)
  db.prepare("INSERT INTO sources (id, candidate_id, type, name, stored_path, mime_type, status, created_at, processed_at) VALUES ('cv1', 'marta', 'cv', 'cv.pdf', 'cv1.txt', 'text/plain', 'processed', ?, ?)").run(at, at)
  const evidence = db.prepare(
    "INSERT INTO evidence (id, candidate_id, statement, epistemic_state, source_type, source_id, strength, created_at, updated_at) VALUES (?, 'marta', ?, 'CANDIDATE_STATED', ?, ?, 'MEDIUM', ?, ?)",
  )
  EVIDENCE.forEach(([statement, source, inCv], i) => evidence.run(`ev${i + 1}`, statement, source, inCv ? 'cv1' : null, at, at))
  OFFERS.forEach(([company, title, text], i) => {
    db.prepare("INSERT INTO companies (id, name, name_norm, status, discovered_via, created_at) VALUES (?, ?, ?, 'watching', 'test', ?)").run(`k${i}`, company, company.toLowerCase(), at)
    db.prepare('INSERT INTO opportunities (id, company_id, title, title_norm, description, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`o${i}`, `k${i}`, title, title.toLowerCase(), `${text} `.repeat(2), at, at)
    db.prepare("INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, created_at) VALUES (?, 'marta', ?, 'h', 'show', '[]', '{}', ?)").run(`m${i}`, `o${i}`, at)
  })
  const started = Date.now()
  const review = await buildCvReview('marta')
  console.log(JSON.stringify(review, null, 2))
  console.log(`(${Math.round((Date.now() - started) / 1000)} s)`)
  const raw = db.prepare("SELECT raw_output AS output FROM model_runs WHERE task = 'cv_review' ORDER BY rowid DESC LIMIT 1").get() as { output: string } | undefined
  if (process.argv.includes('--raw')) console.log(raw?.output)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
