import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { digestText, parseOfferPayload, pickFromDigest } from '../src/lib/whatsapp/offers'
import { dictionaries } from '../src/lib/i18n/dictionaries'

const db = getDb()
const t = new Date().toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(t)

// ── The list's text
const offer = (id: string, title: string, company: string, extra: object = {}) =>
  ({
    id, opportunity_id: `o-${id}`, title, company_name: company, location: 'Madrid · Barcelona', workplace: null,
    salary_raw: null, salary_min: null, salary_max: null, salary_currency: null, url: null, estimate: null,
    explanation: '{}', ...extra,
  }) as unknown as Parameters<typeof digestText>[0][number]['match']
const items = [
  { match: offer('m1', 'Head of Data', 'Pigment', { salary_raw: '90.000 €' }), pitch: { line: 'Llevarías el equipo de datos, como en Mahou.', summary: '', reasons: [], caveat: null } },
  { match: offer('m2', 'Data Lead', 'Factorial'), pitch: { line: 'Montar analítica desde cero, como hiciste en X.', summary: '', reasons: [], caveat: null } },
  { match: offer('m3', 'Analytics Manager', 'Cabify'), pitch: null },
]
const text = digestText(items, dictionaries.es)
console.log(text)
assert.ok(text.startsWith('Hoy he encontrado 3 que creo que merecen tu atención:'))
assert.ok(text.includes('1. *Head of Data* · Pigment\n   Madrid · 90.000 €\n   Llevarías el equipo de datos, como en Mahou.'))
assert.ok(text.includes('2. *Data Lead* · Factorial\n   Madrid · no publica salario'))
assert.ok(text.includes('3. *Analytics Manager* · Cabify\n   Madrid · no publica salario'))
// Too long for a message with buttons: the lines on why go, the rest stays.
const long = digestText(items.map((item) => ({ ...item, pitch: { line: 'x'.repeat(400), summary: '', reasons: [], caveat: null } })), dictionaries.es)
assert.ok(long.length <= 1000 && !long.includes('xxx') && long.includes('3. *Analytics Manager*'))

// ── A number's button
assert.deepEqual(parseOfferPayload('of:m2:show'), { kind: 'offer', matchId: 'm2', answer: 'show' })

// ── Numbers written back
const send = db.prepare(
  "INSERT INTO offer_sends (candidate_id, match_id, opportunity_id, reviewed_at, decision, sent_at, digest_id, digest_pos) VALUES ('c1', ?, ?, ?, 'send', ?, ?, ?)",
)
const run = async () => {
  // No list yet: numbers are for the agent. (Picked: 0 shown, as there is no chat here.)
  assert.equal(await pickFromDigest('c1', '2'), null)
  for (const [i, id] of ['m1', 'm2', 'm3'].entries()) send.run(id, `o-${id}`, t, t, 'd1', i + 1)
  assert.equal(await pickFromDigest('c1', '2'), 0)
  assert.equal(await pickFromDigest('c1', '1 y 3'), 0)
  assert.equal(await pickFromDigest('c1', 'la 1, la 2'), 0)
  assert.equal(await pickFromDigest('c1', 'Todas'), 0)
  // Not on the list (an answer to something else), or words beyond numbers.
  assert.equal(await pickFromDigest('c1', '5'), null)
  assert.equal(await pickFromDigest('c1', '1 y 7'), null)
  assert.equal(await pickFromDigest('c1', 'tengo 3 años de experiencia'), null)
  assert.equal(await pickFromDigest('c1', 'hola'), null)
  // An old list: the numbers are for the agent again.
  db.prepare("UPDATE offer_sends SET sent_at = ? WHERE digest_id = 'd1'").run(new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
  assert.equal(await pickFromDigest('c1', '2'), null)
  console.log('ok #51')
}
void run()
