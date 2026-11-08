import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { answerRuleAsk, parseRuleAskPayload } from '../src/lib/whatsapp/rule-asks'
import { wroteFirstRecently } from '../src/lib/whatsapp/proactive'
import { dictionaries } from '../src/lib/i18n/dictionaries'

assert.deepEqual(parseRuleAskPayload('pp:rpr_1:yes'), { id: 'rpr_1', answer: 'yes' })
assert.equal(parseRuleAskPayload('pr:rpr_1:yes'), null)
console.log(dictionaries.es.whatsapp.ruleAsk('Nada de marketing', 'no quiero nada de marketing'))

const db = getDb()
const t = new Date(Date.now() - 3 * 864e5).toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?), ('c2', 'Bea', ?)").run(t, t)
db.prepare(
  "INSERT INTO revealed_preferences (id, candidate_id, kind, statement, label, origin, evidence_probe_ids, quote, status, created_at, source) VALUES ('rpr_1', 'c1', 'hard_filter', 'No marketing roles.', 'Nada de marketing', 'analysis', '[]', 'no quiero nada de marketing', 'proposed', ?, 'offer')",
).run(t)
const said: string[] = []
const reply = async (text: string) => void said.push(text)
void (async () => {
  // Someone else's: nothing changes.
  await answerRuleAsk('c2', { id: 'rpr_1', answer: 'no' }, reply)
  assert.equal((db.prepare("SELECT status FROM revealed_preferences WHERE id = 'rpr_1'").get() as { status: string }).status, 'proposed')
  // «Solo esta»: set aside.
  await answerRuleAsk('c1', { id: 'rpr_1', answer: 'no' }, reply)
  assert.equal((db.prepare("SELECT status FROM revealed_preferences WHERE id = 'rpr_1'").get() as { status: string }).status, 'rejected')
  assert.equal(said.at(-1), dictionaries.en.whatsapp.ruleAskOnlyThat)
  // Decided already: said so.
  await answerRuleAsk('c1', { id: 'rpr_1', answer: 'yes' }, reply)
  assert.equal(said.at(-1), dictionaries.en.whatsapp.preferenceExpired)
  // Asked today counts as amble writing first.
  db.prepare("UPDATE revealed_preferences SET asked_at = ? WHERE id = 'rpr_1'").run(new Date().toISOString())
  assert.equal(wroteFirstRecently('c1'), true)
  console.log('ok rule asks')
})()
