// Check for #44, on a database of its own (AMBLE_DATA_DIR).
import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { excludedCompanyIds, findTheirCompany, listExcludedCompanies } from '../src/lib/db/excluded-companies'
import { companyAction } from '../src/lib/whatsapp/actions'

const db = getDb()
const t = new Date().toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(t)
for (const [id, name] of [['co_can', 'Canonical'], ['co_aff', 'Affirm, Inc.'], ['co_x', 'Other']]) {
  db.prepare("INSERT INTO companies (id, name, name_norm, status, discovered_via, created_at) VALUES (?, ?, ?, 'active', 'test', ?)").run(id, name, name.toLowerCase(), t)
  db.prepare("INSERT INTO opportunities (id, company_id, title, title_norm, first_seen_at, last_seen_at) VALUES (?, ?, 'Role', 'role', ?, ?)").run(`o_${id}`, id, t, t)
  db.prepare(
    "INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, created_at) VALUES (?, 'c1', ?, 'h', 'show', '[]', '{}', ?)",
  ).run(`m_${id}`, `o_${id}`, t)
}

assert.equal(findTheirCompany('c1', 'canonical')?.id, 'co_can')
assert.equal(findTheirCompany('c1', 'Affirm')?.id, 'co_aff')
assert.equal(findTheirCompany('c1', 'Microsoft'), null)

assert.deepEqual(companyAction('c1', { type: 'exclude_company', company: 'Canonical', forAYear: false }), { company: 'Canonical', until: null })
const affirm = companyAction('c1', { type: 'exclude_company', company: 'affirm', forAYear: true })
assert.equal(affirm?.company, 'Affirm, Inc.')
assert.ok(affirm?.until && affirm.until > new Date(Date.now() + 360 * 864e5).toISOString())
assert.equal(companyAction('c1', { type: 'exclude_company', company: 'Microsoft', forAYear: false }), null)
assert.deepEqual([...excludedCompanyIds('c1')].sort(), ['co_aff', 'co_can'])

// One whose year is over no longer holds.
db.prepare("UPDATE excluded_companies SET until = '2020-01-01' WHERE company_id = 'co_aff'").run()
assert.deepEqual([...excludedCompanyIds('c1')], ['co_can'])

// Let back in.
assert.deepEqual(companyAction('c1', { type: 'include_company', company: 'canonical' }), { company: 'Canonical', until: null })
assert.equal(listExcludedCompanies('c1').length, 0)
assert.equal(companyAction('c1', { type: 'include_company', company: 'canonical' }), null)
console.log('ok #44')
