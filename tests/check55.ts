import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIRECTORY, getDb } from '../src/lib/db/db'
import { cvReviewState, groundReview, MIN_OFFERS, offersToCompare, plainChecks, type CvReviewOutput } from '../src/lib/career/cv-review'
import { pageInColumns } from '../src/lib/pdf/columns'
import { wroteFirstRecently } from '../src/lib/whatsapp/proactive'
import { dictionaries } from '../src/lib/i18n/dictionaries'

// #55, «Tu CV, mejor»: nothing reaches the page that cannot be checked.

const cv = `[page 1]
Ana Pérez · ana@correo.com · +34 600 123 456
Marketing Manager, Mahou (2019 - 2024)
Lancé campañas de marca.
Experiencia en analítica digital.
Brand Manager, El Grifo
[page 2]
Formación: ADE`
const offers = [
  { id: 'opp1', company: 'Pigment', title: 'Head of Marketing' },
  { id: 'opp2', company: 'Factorial', title: 'Marketing Lead' },
  { id: 'opp3', company: 'Cabify', title: 'Brand Lead' },
]
const evidence = [
  { id: 'e-cv', statement: 'Lanzó campañas de marca en Mahou', source: 'cv', inCv: true },
  { id: 'e-chat', statement: 'Llevó un equipo de 6 personas en Mahou', source: 'interview', inCv: false },
  { id: 'e-gh', statement: 'Usa Google Analytics 4 y Looker Studio', source: 'linkedin', inCv: false },
]
const blank = { evidence: [], cvQuote: null, line: null }
const output: CvReviewOutput = {
  hidden: [
    { ...blank, need: 'gestión de equipo', offers: ['o1', 'o2'], evidence: ['e-chat'], line: 'Lideré un equipo de 6 personas en Mahou.' },
    // Only from the CV: the CV already says it.
    { ...blank, need: 'campañas', offers: ['o1'], evidence: ['e-cv'], line: 'Lancé campañas.' },
    // An id that is not theirs.
    { ...blank, need: 'pricing', offers: ['o1'], evidence: ['e-made-up'], line: 'Definí precios.' },
    // An offer they were not shown.
    { ...blank, need: 'liderazgo', offers: ['o9'], evidence: ['e-chat'], line: 'Lideré.' },
    // The same need twice.
    { ...blank, need: 'Gestión de equipo', offers: ['o3'], evidence: ['e-chat'], line: 'Otra vez.' },
  ],
  weak: [
    { ...blank, need: 'resultados de campaña', offers: ['o3'], evidence: ['e-cv'], cvQuote: 'Lancé campañas de marca.', line: 'Lancé campañas de marca en Mahou.' },
    // A quote that is not in the CV.
    { ...blank, need: 'otra', offers: ['o3'], evidence: ['e-cv'], cvQuote: 'Dirigí la estrategia global', line: 'x' },
  ],
  missing: [
    { ...blank, need: 'SQL', offers: ['o1', 'o3'] },
    // One offer is not a pattern.
    { ...blank, need: 'Figma', offers: ['o2'] },
  ],
  filter: [
    { kind: 'undated', cvQuote: 'Brand Manager, El Grifo', evidence: [], line: null },
    { kind: 'generic', cvQuote: 'Experiencia en analítica digital.', evidence: ['e-gh'], line: 'Analítica digital con Google Analytics 4 y Looker Studio.' },
    // Nothing of theirs names it: nothing to put instead.
    { kind: 'generic', cvQuote: 'Formación: ADE', evidence: [], line: 'ADE con matrícula' },
    { kind: 'undated', cvQuote: 'Director de algo', evidence: [], line: null },
  ],
}
const grounded = groundReview(output, { cv, offers, evidence })
assert.deepEqual(grounded.hidden.map((item) => item.need), ['gestión de equipo'])
assert.deepEqual(grounded.hidden[0].offers.map((offer) => offer.company), ['Pigment', 'Factorial'])
assert.deepEqual(grounded.hidden[0].proof, ['Llevó un equipo de 6 personas en Mahou'])
assert.deepEqual(grounded.weak.map((item) => item.cvQuote), ['Lancé campañas de marca.'])
assert.deepEqual(grounded.missing.map((item) => item.need), ['SQL'])
assert.equal(grounded.missing[0].line, null)
assert.deepEqual(grounded.filter.map((check) => check.kind), ['undated', 'generic'])

// ── What a filter sees, without the model
assert.deepEqual(plainChecks(cv, 2).map((check) => check.kind), ['no_linkedin', 'short'])
const long = `${'palabra '.repeat(900)} ana@correo.com +34 600 123 456 linkedin.com/in/ana`
assert.deepEqual(plainChecks(long, 4), [{ kind: 'long', pages: 4 }])
assert.deepEqual(plainChecks(long, 2), [])
assert.deepEqual(plainChecks(`${'palabra '.repeat(300)} sin contacto`, 1).map((check) => check.kind), ['no_email', 'no_phone', 'no_linkedin'])

// ── Two columns, and a date at the right of one
const width = 600
const sidebar = Array.from({ length: 30 }, (_, i) => [
  { str: 'Skills and tools', x: 30, y: 800 - i * 20, width: 120 },
  { str: 'Led the brand relaunch across three markets', x: 220, y: 800 - i * 20, width: 330 },
]).flat()
assert.equal(pageInColumns(sidebar, width), true)
const dated = Array.from({ length: 30 }, (_, i) => [
  { str: 'Marketing Manager at Mahou San Miguel', x: 40, y: 800 - i * 20, width: 260 },
  { str: '2019 - 2024', x: 500, y: 800 - i * 20, width: 70 },
]).flat()
assert.equal(pageInColumns(dated, width), false)
const plain = Array.from({ length: 30 }, (_, i) => ({ str: 'One line of text running across the page as usual', x: 40, y: 800 - i * 20, width: 500 }))
assert.equal(pageInColumns(plain, width), false)

// ── When the page has something, and the chat says it once
const db = getDb()
const day = 24 * 3600 * 1000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(ago(30))
assert.equal(cvReviewState('c1').state.kind, 'no_cv')
fs.mkdirSync(path.join(DATA_DIRECTORY, 'uploads'), { recursive: true })
fs.writeFileSync(path.join(DATA_DIRECTORY, 'uploads', 'src1.txt'), cv)
db.prepare(
  "INSERT INTO sources (id, candidate_id, type, name, stored_path, mime_type, status, created_at, processed_at) VALUES ('src1', 'c1', 'cv', 'cv.pdf', 'src1.txt', 'text/plain', 'processed', ?, ?)",
).run(ago(20), ago(20))
db.prepare("INSERT INTO companies (id, name, name_norm, status, discovered_via, created_at) VALUES ('k1', 'Pigment', 'pigment', 'watching', 'test', ?)").run(ago(30))
const opp = db.prepare("INSERT INTO opportunities (id, company_id, title, title_norm, description, first_seen_at, last_seen_at) VALUES (?, 'k1', ?, ?, ?, ?, ?)")
const match = db.prepare("INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, created_at) VALUES (?, 'c1', ?, 'h', ?, '[]', '{}', ?)")
for (let i = 1; i < MIN_OFFERS; i++) {
  opp.run(`o${i}`, `Role ${i}`, `role ${i}`, 'Buscamos a alguien que '.repeat(20), ago(10), ago(1))
  match.run(`m${i}`, `o${i}`, 'show', ago(10 - i / 100))
}
// Set aside, or turned down: not compared with.
opp.run('ox', 'Held', 'held', 'Buscamos a alguien que '.repeat(20), ago(10), ago(1))
match.run('mx', 'ox', 'hold', ago(9))
opp.run('oy', 'No', 'no', 'Buscamos a alguien que '.repeat(20), ago(10), ago(1))
match.run('my', 'oy', 'show', ago(9))
db.prepare("INSERT INTO opportunity_decisions (candidate_id, opportunity_id, decision, decided_at) VALUES ('c1', 'oy', 'not_for_me', ?)").run(ago(8))
assert.deepEqual(cvReviewState('c1'), { state: { kind: 'few_offers', have: MIN_OFFERS - 1, need: MIN_OFFERS }, build: false })
opp.run('o-liked', 'Liked', 'liked', 'Buscamos a alguien que '.repeat(20), ago(10), ago(1))
match.run('m-liked', 'o-liked', 'show', ago(20))
db.prepare("INSERT INTO opportunity_decisions (candidate_id, opportunity_id, decision, decided_at) VALUES ('c1', 'o-liked', 'interested', ?)").run(ago(8))
assert.equal(offersToCompare('c1')[0].id, 'o-liked', 'what they liked first')
assert.deepEqual(cvReviewState('c1'), { state: { kind: 'building' }, build: true })
// A build under way: not another.
db.prepare("UPDATE candidates SET cv_review_started_at = ? WHERE id = 'c1'").run(new Date().toISOString())
assert.deepEqual(cvReviewState('c1'), { state: { kind: 'building' }, build: false })
db.prepare("UPDATE candidates SET cv_review_started_at = NULL, cv_review_failed_at = ? WHERE id = 'c1'").run(new Date().toISOString())
assert.deepEqual(cvReviewState('c1'), { state: { kind: 'failed' }, build: false })
db.prepare("UPDATE candidates SET cv_review_failed_at = NULL WHERE id = 'c1'").run()
const review = { ...grounded, filter: [], offersRead: 10, createdAt: ago(1) }
db.prepare("INSERT INTO cv_reviews (id, candidate_id, source_id, data, created_at) VALUES ('r1', 'c1', 'src1', ?, ?)").run(JSON.stringify(review), ago(1))
const ready = cvReviewState('c1')
assert.equal(ready.state.kind, 'ready')
assert.equal(ready.build, false)
// A newer CV: built again, and the old one not shown as if it were of it.
db.prepare(
  "INSERT INTO sources (id, candidate_id, type, name, stored_path, mime_type, status, created_at, processed_at) VALUES ('src2', 'c1', 'cv', 'cv2.pdf', 'src1.txt', 'text/plain', 'processed', ?, ?)",
).run(ago(0.5), ago(0.5))
assert.deepEqual(cvReviewState('c1'), { state: { kind: 'building' }, build: true })

assert.equal(wroteFirstRecently('c1'), false)
db.prepare("UPDATE candidates SET cv_review_told_at = ? WHERE id = 'c1'").run(new Date().toISOString())
assert.equal(wroteFirstRecently('c1'), true, 'telling them counts as writing first')

const text = dictionaries.es.whatsapp.cvNudge(3, 'gestión de equipo', 'https://app.amble.fyi/go/x')
console.log(text)
assert.ok(text.includes('Hay 3 cosas que has hecho y tu CV no cuenta, como gestión de equipo.'))
assert.ok(dictionaries.es.whatsapp.cvNudge(1, 'gestión de equipo', 'u').includes('no cuenta: gestión de equipo.'))
console.log('ok 55')
