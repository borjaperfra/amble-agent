import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { quietNoteDue, quietNoteText, QUIET_DAYS } from '../src/lib/whatsapp/quiet'
import { wroteFirstRecently } from '../src/lib/whatsapp/proactive'
import { dictionaries } from '../src/lib/i18n/dictionaries'

const d = dictionaries.es
const link = 'https://app.amble.fyi/x'

// ── What it says
const rule = quietNoteText({ days: 5, reason: { kind: 'rule', rule: 'Solo full remote', count: 300 }, waiting: 12, link }, d)
console.log(rule)
assert.equal(
  rule,
  'Llevo 5 días sin mandarte nada: lo que he leído no merecía tu atención. La mayoría chocaba con «Solo full remote».\n\nEn la app tienes 12 que no te he mandado por aquí: https://app.amble.fyi/x\n\n¿Quieres que afloje «Solo full remote», o lo mantengo?',
)
const pay = quietNoteText({ days: 4, reason: { kind: 'pay', rule: null, count: 40 }, waiting: 0, link }, d)!
assert.ok(pay.includes('pagaba menos de tu mínimo') && pay.endsWith('¿Miro también las que pagan algo menos, si lo demás encaja?') && !pay.includes('En la app'))
// Only what waits in the app: said, with the general question.
const onlyWaiting = quietNoteText({ days: 6, reason: null, waiting: 1, link }, d)!
assert.ok(onlyWaiting.includes('tienes 1 que no te he mandado') && onlyWaiting.endsWith('¿Quieres que amplíe algo de lo que busco?'))
// Nothing read and nothing waiting: nothing worth saying.
assert.equal(quietNoteText({ days: 9, reason: null, waiting: 0, link }, d), null)

// ── When it is due
const db = getDb()
const day = 24 * 3600 * 1000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(ago(30))
// No chat: never.
assert.equal(quietNoteDue('c1'), null)
db.prepare("INSERT INTO telegram_links (candidate_id, chat_id, linked_at) VALUES ('c1', '42', ?)").run(ago(2))
assert.equal(quietNoteDue('c1'), null)
db.prepare("UPDATE telegram_links SET linked_at = ? WHERE candidate_id = 'c1'").run(ago(QUIET_DAYS + 1))
assert.deepEqual(quietNoteDue('c1'), { days: QUIET_DAYS + 1 })
// An offer sent two days ago: the chat is not quiet.
db.prepare("INSERT INTO offer_sends (candidate_id, match_id, opportunity_id, reviewed_at, decision, sent_at) VALUES ('c1', 'm1', 'o1', ?, 'send', ?)").run(ago(2), ago(2))
assert.equal(quietNoteDue('c1'), null)
db.prepare("UPDATE offer_sends SET sent_at = ? WHERE candidate_id = 'c1'").run(ago(10))
assert.deepEqual(quietNoteDue('c1'), { days: 10 })
// Said three days ago: not again within the week; and it counts as writing first.
db.prepare("UPDATE candidates SET quiet_note_at = ? WHERE id = 'c1'").run(ago(3))
assert.equal(quietNoteDue('c1'), null)
db.prepare("UPDATE candidates SET quiet_note_at = ? WHERE id = 'c1'").run(new Date().toISOString())
assert.equal(wroteFirstRecently('c1'), true)
db.prepare("UPDATE candidates SET quiet_note_at = ? WHERE id = 'c1'").run(ago(8))
assert.equal(wroteFirstRecently('c1'), false)
assert.deepEqual(quietNoteDue('c1'), { days: 10 })
// Looked at an hour ago with nothing to say: not again today.
db.prepare("UPDATE candidates SET quiet_checked_at = ? WHERE id = 'c1'").run(new Date(Date.now() - 3600 * 1000).toISOString())
assert.equal(quietNoteDue('c1'), null)
console.log('ok #51 quiet')
