import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { oldestUnsent } from '../src/lib/whatsapp/nudges'
import { weekOf, weekText, weeklyDueToday } from '../src/lib/whatsapp/weekly'
import { moreImportantToday } from '../src/lib/whatsapp/arbiter'
import { wroteFirstRecently } from '../src/lib/whatsapp/proactive'
import { dictionaries } from '../src/lib/i18n/dictionaries'

const db = getDb()
const day = 24 * 3600 * 1000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(ago(30))
const company = db.prepare("INSERT INTO companies (id, name, name_norm, status, discovered_via, created_at) VALUES (?, ?, ?, 'watching', 'test', ?)")
for (const [id, name] of [['k1', 'Pigment'], ['k2', 'Factorial'], ['k3', 'Cabify']]) company.run(id, name, name.toLowerCase(), ago(30))
const opp = db.prepare("INSERT INTO opportunities (id, company_id, title, title_norm, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
opp.run('o1', 'k1', 'Head of Data', 'head of data', ago(20), ago(1))
opp.run('o2', 'k2', 'Data Lead', 'data lead', ago(20), ago(1))
opp.run('o3', 'k3', 'Analytics Manager', 'analytics manager', ago(20), ago(1))
const match = db.prepare(
  "INSERT INTO opportunity_matches (id, candidate_id, opportunity_id, profile_hash, verdict, gates, explanation, created_at) VALUES (?, 'c1', ?, 'h', 'show', '[]', '{}', ?)",
)
for (const id of ['o1', 'o2', 'o3']) match.run(`m-${id}`, id, ago(10))
const decide = db.prepare("INSERT INTO opportunity_decisions (candidate_id, opportunity_id, decision, decided_at, progress, progress_at) VALUES ('c1', ?, ?, ?, ?, ?)")

// ── An offer they liked, not sent
decide.run('o1', 'interested', ago(5), null, null)
assert.equal(oldestUnsent('c1')?.match_id, 'm-o1')
db.prepare("UPDATE opportunity_decisions SET decided_at = ? WHERE opportunity_id = 'o1'").run(ago(1))
assert.equal(oldestUnsent('c1'), null, 'not before three days')
db.prepare("UPDATE opportunity_decisions SET decided_at = ?, nudged_at = ? WHERE opportunity_id = 'o1'").run(ago(5), new Date().toISOString())
assert.equal(oldestUnsent('c1'), null, 'once')
assert.equal(wroteFirstRecently('c1'), true, 'it counts as writing first')
db.prepare("UPDATE opportunity_decisions SET nudged_at = ? WHERE opportunity_id = 'o1'").run(ago(3))

// ── The week
decide.run('o2', 'interested', ago(6), 'applied', ago(2))
decide.run('o3', 'interested', ago(9), 'applied', ago(12))
db.prepare("INSERT INTO application_followups (candidate_id, opportunity_id, round, asked_at, answer, answered_at) VALUES ('c1', 'o3', 1, ?, 'called', ?)").run(ago(4), ago(3))
const week = weekOf('c1')
assert.deepEqual(week.sent, ['Factorial'])
assert.deepEqual(week.called, ['Cabify'])
assert.equal(week.liked, 2)
assert.equal(week.unsent?.matchId, 'm-o1')
const text = weekText(week, dictionaries.es)
console.log(text)
assert.ok(text.includes('• Enviaste la candidatura a Factorial.') && text.includes('• De Cabify te llamaron.') && text.endsWith('¿Te la preparo?'))

// Mondays only, when something moved, not twice in the week.
const monday = new Date('2026-11-09T10:00:00Z')
const tuesday = new Date('2026-11-10T10:00:00Z')
assert.equal(weeklyDueToday('c1', tuesday), false)
// (weekOf reads the week before `at`; the fixtures are relative to now, so
// check Monday's rule against now's week by shifting nothing else.)
db.prepare("UPDATE candidates SET weekly_at = ? WHERE id = 'c1'").run(new Date(monday.getTime() - 2 * day).toISOString())
assert.equal(weeklyDueToday('c1', monday), false, 'sent two days before')

// ── What goes first
db.prepare("INSERT INTO whatsapp_reminders (id, candidate_id, due_on, message, created_at) VALUES ('r1', 'c1', ?, 'Mañana la entrevista', ?)").run(new Date().toISOString().slice(0, 10), ago(2))
assert.equal(moreImportantToday('c1'), 'reminder')
db.prepare("UPDATE whatsapp_reminders SET sent_at = ? WHERE id = 'r1'").run(new Date().toISOString())
// Factorial sent 2 days ago: no follow-up yet; nothing first, unless Monday.
assert.equal(moreImportantToday('c1') === null || moreImportantToday('c1') === 'weekly', true)
db.prepare("UPDATE opportunity_decisions SET progress_at = ? WHERE opportunity_id = 'o2'").run(ago(8))
assert.equal(moreImportantToday('c1'), 'followup')
console.log('ok rep')
