import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { offerText } from '../src/lib/whatsapp/offers'
import { dictionaries } from '../src/lib/i18n/dictionaries'

getDb()
const match = {
  id: 'm1', opportunity_id: 'o1', title: 'Head of Data', company_name: 'Pigment', location: 'Madrid', workplace: null,
  salary_raw: '90.000 €', salary_min: null, salary_max: null, salary_currency: null, url: 'https://example.com/o1', estimate: null,
  explanation: JSON.stringify({ summary: 'first reader summary', why: [{ text: 'a' }], roleFit: { fit: 'fits', reason: '' }, unknowns: [] }),
} as unknown as Parameters<typeof offerText>[0]
const d = dictionaries.es

const withBoth = offerText(match, { company: 'hace software para planificar presupuestos.', dayToDay: 'liderar el equipo de datos y contratar a dos personas.', summary: 'Es tuyo.', reasons: ['r1'], caveat: null }, d)
assert.ok(withBoth.includes('*La empresa:* hace software para planificar presupuestos.'))
assert.ok(withBoth.includes('*Tu día a día:* liderar el equipo de datos y contratar a dos personas.'))
assert.ok(withBoth.indexOf('La empresa') < withBoth.indexOf('Es tuyo.'))

const unsaid = offerText(match, { company: null, dayToDay: null, summary: 'Es tuyo.', reasons: [], caveat: null }, d)
assert.ok(unsaid.includes('*La empresa:* la oferta no cuenta a qué se dedica.'))
assert.ok(unsaid.includes('*Tu día a día:* la oferta no lo concreta.'))

// A pitch stored before r3, or none at all: the message as it was.
const old = offerText(match, { summary: 'Es tuyo.', reasons: [], caveat: null }, d)
assert.ok(!old.includes('La empresa'))
assert.ok(!offerText(match, null, d).includes('La empresa'))
// No pitch, but the first reader (v13) wrote them: the message uses them.
const v13 = { ...match, explanation: JSON.stringify({ ...JSON.parse(match.explanation), companyDoes: 'hace robots.', dayToDay: null }) } as typeof match
const fromFirst = offerText(v13, null, d)
assert.ok(fromFirst.includes('*La empresa:* hace robots.') && fromFirst.includes('*Tu día a día:* la oferta no lo concreta.'))
console.log('ok #50')
