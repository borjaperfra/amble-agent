import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ALWAYS, APP, base, check, merge, pattern, type EvalFile, type Json } from '../scripts/eval-agent-checks'
import { agentSchema, promisesWithoutKeeping, type AgentAnswer, type AgentContext } from '../src/lib/whatsapp/agent'
import { appPagesAt } from '../src/lib/whatsapp/capabilities'

// The agent's evals (evals/agent/*.json) are well formed, with no model:
// each names intents and actions the agent has, writes its context with the
// names WHAT YOU KNOW uses, and every pattern compiles; and the checks every
// reply goes through catch what they are for. The evals themselves call the
// model: npm run eval:agent, with a key of its own.

interface Def {
  out?: { _zod: { def: Def } }
  innerType?: { _zod: { def: Def } }
  options?: { _zod: { def: Def } }[]
  shape?: Record<string, { _zod: { def: Def } }>
  values?: unknown[]
  entries?: Record<string, string>
}
const def = (schema: { _zod: { def: Def } }) => schema._zod.def
const object = def(def(agentSchema as unknown as { _zod: { def: Def } }).out!)
const intents = Object.values(def(object.shape!.intent).entries ?? {})
const actions = def(def(object.shape!.action).innerType!).options!.map((option) => String(def(def(option).shape!.type).values?.[0]))
assert.ok(intents.includes('amble') && actions.includes('connect_app'), 'could not read the schema')

const today = '2026-11-08 (Sunday)'
const context = base(today, appPagesAt(APP))
const keys = new Set(Object.keys(context))
const folder = path.resolve(__dirname, '..', 'evals', 'agent')
const files = fs.readdirSync(folder).filter((name) => name.endsWith('.json'))
assert.ok(files.length > 0, 'no evals')

const ids = new Set<string>()
const allowed = new Set([...Object.keys(ALWAYS), 'links'])
const expectKeys = new Set(['intent', 'action', 'actionHas', 'preference', 'forward', 'answersInterview', 'reasonItDoesNotFit', 'reminders', 'replyIncludes', 'replyIncludesAny'])
let count = 0
for (const name of files) {
  const file = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as EvalFile
  assert.ok(file.feedback, `${name}: say what feedback it comes from`)
  assert.ok(Array.isArray(file.cases) && file.cases.length > 0, `${name}: no cases`)
  for (const item of file.cases) {
    count++
    const where = `${name} › ${item.id}`
    assert.ok(item.id && !ids.has(item.id), `${where}: id missing or twice`)
    ids.add(item.id)
    assert.ok(item.message?.trim(), `${where}: no message`)
    assert.ok(item.expect && Object.keys(item.expect).length > 0 || (item.forbid ?? []).length > 0, `${where}: expects nothing`)
    for (const key of Object.keys(item.expect ?? {})) assert.ok(expectKeys.has(key), `${where}: expect.${key} is not a check`)
    for (const intent of [item.expect.intent ?? []].flat()) assert.ok(intents.includes(intent), `${where}: no intent ${intent}`)
    if (item.expect.action !== undefined) {
      for (const action of [item.expect.action].flat()) assert.ok(action === null || actions.includes(action), `${where}: no action ${action}`)
    }
    if (item.expect.actionHas) assert.ok(typeof item.expect.action === 'string', `${where}: actionHas needs one action`)
    for (const words of [...(item.expect.replyIncludes ?? []), ...(item.expect.replyIncludesAny ?? []), ...(item.forbid ?? [])]) pattern(words)
    for (const name of item.allow ?? []) assert.ok(allowed.has(name), `${where}: allow «${name}» is not a check`)
    // Its context is WHAT YOU KNOW, by the names contextFor uses.
    for (const key of Object.keys(item.context ?? {})) assert.ok(keys.has(key), `${where}: context.${key} is not in WHAT YOU KNOW`)
    const merged = merge(context as unknown as Json, item.context ?? {})
    assert.deepEqual(Object.keys(merged).sort(), [...keys].sort())
  }
}
assert.ok(count >= 30, `only ${count} cases`)

// The checks every reply goes through catch what they are for.
const answer = (reply: string, more: Partial<AgentAnswer> = {}): AgentAnswer => ({
  intent: 'smalltalk',
  reply,
  preference: null,
  action: null,
  reminders: [],
  answersInterview: false,
  reasonItDoesNotFit: null,
  forward: false,
  reaction: null,
  ...more,
})
const judge = (reply: string, more: Partial<AgentAnswer> = {}, item: Partial<EvalFile['cases'][number]> = {}) =>
  check({ id: 't', message: 'm', expect: {}, ...item }, answer(reply, more), context as AgentContext, promisesWithoutKeeping)
assert.deepEqual(judge(`Aquí la tienes: ${APP}/opportunities?tab=new`), [])
assert.ok(judge('Encaja al 80 %').some((why) => why.startsWith('percent')))
assert.ok(judge('Tu floor es 60.000 €').some((why) => why.startsWith('internal')))
assert.ok(judge('Te noto muy cansado. ¿Estás muy agobiado?').some((why) => why.startsWith('gender')))
assert.ok(judge('Sigo muy interesado en el puesto').some((why) => why.startsWith('gender')))
assert.deepEqual(judge('Sigo con interés en el puesto, y entiendo que te canse buscar.'), [])
assert.ok(judge('Lo apunto para no mandarte más de Affirm.').some((why) => why.includes('promises')))
assert.deepEqual(judge('Lo apunto.', { action: { type: 'exclude_company', company: 'Affirm', forAYear: true } }), [])
assert.ok(judge('Mira https://evil.example/x').some((why) => why.startsWith('links')))
assert.deepEqual(judge('Mira https://evil.example/x', {}, { allow: ['links'] }), [])
assert.ok(judge('Si amble funciona allí, no lo sé', {}, { forbid: ['no lo sé'] }).length === 1)
assert.deepEqual(judge(`Ahí: ${APP}/me/preferences`, {}, { expect: { replyIncludes: ['/me/preferences'] } }), [])
assert.ok(judge('Te mando el enlace.', { intent: 'amble' }, { expect: { action: 'connect_app', intent: 'profile' } }).length === 2)
assert.deepEqual(
  judge('Vale.', { action: { type: 'exclude_company', company: 'Affirm, Inc.', forAYear: true } }, { expect: { action: 'exclude_company', actionHas: { company: 'affirm', forAYear: true } } }),
  [],
)
