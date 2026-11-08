import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { answeredGapIds, answeredTurns, askableGapCount } from '../src/lib/db/repo'

const db = getDb()
const t = new Date().toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(t)
const gap = db.prepare(
  "INSERT INTO uncertainties (id, candidate_id, capability_id, description, materiality, status, resolvable_by_interview, kind, created_at) VALUES (?, 'c1', 'cap', ?, ?, 'OPEN', ?, ?, ?)",
)
gap.run('g1', 'Mahou launches: who decided', 'HIGH', 1, 'MATERIALITY', t)
gap.run('g2', 'El Grifo: what was theirs', 'MEDIUM', 1, 'MATERIALITY', t)
gap.run('g3', 'minor', 'LOW', 0, 'MATERIALITY', t)
gap.run('g4', 'whose was it', 'MEDIUM', 0, 'ATTRIBUTION', t)
assert.equal(askableGapCount('c1'), 3)

// Round one, in an interview since completed: g1 asked and answered, g2 asked, not answered.
db.prepare("INSERT INTO interviews (id, candidate_id, status, created_at) VALUES ('i1', 'c1', 'completed', ?)").run(t)
const turn = db.prepare(
  "INSERT INTO interview_turns (id, interview_id, idx, question, target_capability_ids, target_uncertainty_ids, kind, target_evidence_ids, answer, created_at) VALUES (?, 'i1', ?, 'q', '[\"cap\"]', ?, ?, '[]', ?, ?)",
)
turn.run('t1', 0, '["g1"]', 'gap', 'I decided the pricing', t)
turn.run('t2', 1, '["g2"]', 'gap', null, t)
turn.run('t3', 2, '[]', 'note', 'a note', t)

assert.deepEqual([...answeredGapIds('c1')], ['g1'])
assert.equal(answeredTurns('c1').length, 1)
// g1 was asked: no longer counted, though still open. g2 was never answered: still to ask.
assert.equal(askableGapCount('c1'), 2)
console.log('ok #47')
