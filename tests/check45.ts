import assert from 'node:assert/strict'
import { roleKey, roleTitle } from '../src/lib/matching/role-key'

// Same role: one key.
assert.equal(roleTitle('Product Engineering Lead, Keet (100% Remote, Worldwide)'), 'product engineering lead keet')
assert.equal(roleTitle('Product Engineering Lead (QVAC) (100% remote)'), 'product engineering lead qvac')
assert.equal(roleTitle('Software Engineer II, Backend (Furnishing Platform)'), roleTitle('Software Engineer II , Backend, (Furnishing Platform)'))
assert.equal(roleTitle('Backend Engineer - Remote Spain'), 'backend engineer')
assert.equal(roleTitle('Backend Engineer (UK)'), 'backend engineer')
assert.equal(roleTitle('Ingeniera de Datos (Remoto)'), 'ingeniera de datos')

// Different roles: different keys.
assert.notEqual(roleTitle('Product Engineering Lead (QVAC)'), roleTitle('Product Engineering Lead, Keet'))
assert.notEqual(roleTitle('Software Engineer II, Backend (Card)'), roleTitle('Software Engineer II, Backend (Furnishing Platform)'))
assert.equal(roleTitle('Full-Stack Engineer - ElevenMusic'), 'full stack engineer elevenmusic')
assert.notEqual(roleTitle('Senior Engineer'), roleTitle('Engineer'))
// A word that merely contains a place code is not a place: «Business», «Customer».
assert.equal(roleTitle('Customer Success (Business)'), 'customer success business')

const a = { company_id: 'tether', title: 'Product Engineering Lead, Keet (100% Remote, Worldwide)', workplace: 'remote' }
assert.equal(roleKey(a), roleKey({ ...a, title: 'Product Engineering Lead, Keet (100% remote)' }))
assert.notEqual(roleKey(a), roleKey({ ...a, company_id: 'other' }))
assert.notEqual(roleKey(a), roleKey({ ...a, workplace: 'onsite' }))
console.log('ok #45')
