import assert from 'node:assert/strict'
import { promisesWithoutKeeping } from '../src/lib/whatsapp/agent'
const base = { action: null, preference: null, reminders: [], answersInterview: false, reasonItDoesNotFit: null }
assert.equal(promisesWithoutKeeping({ ...base, reply: 'Vale, lo apunto: nada de Affirm.' }), true)
assert.equal(promisesWithoutKeeping({ ...base, reply: 'Entendido, no te mandaré más de Canonical.' }), true)
assert.equal(promisesWithoutKeeping({ ...base, reply: "Got it, I'll keep that in mind." }), true)
assert.equal(promisesWithoutKeeping({ ...base, reply: 'Vale, lo apunto.', action: { type: 'exclude_company', company: 'Affirm', forAYear: true } }), false)
assert.equal(promisesWithoutKeeping({ ...base, reply: 'Te sugiero preparar dos ejemplos concretos.' }), false)
assert.equal(promisesWithoutKeeping({ ...base, reply: '¿Te llamo Bea a partir de ahora?' }), false)
console.log('ok promise')
