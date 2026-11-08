import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { agentSchema, SYSTEM_PROMPT } from '../src/lib/whatsapp/agent'
import { ACTION_CAPABILITY, APP_CAPABILITIES, APP_PAGES, appPagesAt, CAPABILITIES, CHAT_CAPABILITIES } from '../src/lib/whatsapp/capabilities'

// What the Rep says amble can do holds together, with no model: each action
// it may take is in its type, its schema, its prompt, the registry and a
// handler; each page it links to exists. A feature added in one place and
// not the others fails here, before a tester asks the Rep about it (#52).

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

// The actions the schema takes (zod 4: preprocess → pipe → object → action
// nullable → union of objects, each with a literal type).
interface Def {
  type?: string
  out?: Schema
  innerType?: Schema
  options?: Schema[]
  shape?: Record<string, Schema>
  values?: unknown[]
}
interface Schema {
  _zod: { def: Def }
}
const def = (schema: Schema) => schema._zod.def
const object = def(agentSchema as unknown as Schema).out!
const actionUnion = def(def(object).shape!.action).innerType!
const schemaActions = def(actionUnion).options!.map((option) => {
  const literal = def(def(option).shape!.type)
  return String(literal.values?.[0])
})
assert.ok(schemaActions.length >= 10, `read ${schemaActions.length} actions from the schema: has its shape changed?`)
assert.equal(new Set(schemaActions).size, schemaActions.length, 'an action twice in the schema')

// The actions in the AgentAction type, as written in agent.ts.
const agentSource = read('src/lib/whatsapp/agent.ts')
const typeBlock = agentSource.slice(agentSource.indexOf('export type AgentAction ='), agentSource.indexOf('export type ChatApp'))
const typeActions = [...typeBlock.matchAll(/type: '([a-z_]+)'/g)].map((match) => match[1])
assert.deepEqual([...typeActions].sort(), [...schemaActions].sort(), 'AgentAction and the schema name different actions')

// Every action: in the prompt's JSON, in the registry, and handled.
const handlers = read('src/lib/whatsapp/inbound.ts') + read('src/lib/whatsapp/actions.ts')
const inRegistry = new Set(CAPABILITIES.flatMap((capability) => capability.actions ?? []))
for (const action of schemaActions) {
  assert.ok(SYSTEM_PROMPT.includes(`"${action}"`), `the prompt does not name the action ${action}`)
  assert.ok(action in ACTION_CAPABILITY, `${action} has no entry in ACTION_CAPABILITY`)
  assert.ok(inRegistry.has(action as never), `no capability says it is done by ${action}`)
  assert.ok(new RegExp(`type [!=]== '${action}'`).test(handlers), `nothing in inbound.ts or actions.ts handles ${action}`)
}

// Every action the registry names is one the schema takes.
for (const action of [...inRegistry, ...Object.keys(ACTION_CAPABILITY)]) {
  assert.ok(schemaActions.includes(action), `the registry names ${action}, which the schema does not take`)
}
const ids = CAPABILITIES.map((capability) => capability.id)
assert.equal(new Set(ids).size, ids.length, 'a capability id twice')
for (const [action, id] of Object.entries(ACTION_CAPABILITY)) {
  const capability = CAPABILITIES.find((item) => item.id === id)
  assert.ok(capability, `ACTION_CAPABILITY sends ${action} to ${id}, which is not a capability`)
  assert.ok(capability.actions?.includes(action as never), `${id} does not list ${action} among its actions`)
}

// Every capability: a line for the model, a channel; in the app, a page.
for (const capability of CAPABILITIES) {
  assert.ok(capability.does.trim().length > 10, `${capability.id} says nothing`)
  assert.ok(!capability.does.includes('\n'), `${capability.id}: one line`)
  assert.ok(capability.channels.length > 0, `${capability.id} is on no channel`)
  assert.ok(SYSTEM_PROMPT.includes(capability.does), `${capability.id} is not in the prompt`)
}
for (const capability of CHAT_CAPABILITIES) assert.ok(capability.channels.some((channel) => channel !== 'app'), `${capability.id} is in the chat's list but not on a chat`)
for (const capability of APP_CAPABILITIES) assert.ok(capability.page, `${capability.id} is in the app but names no page`)

// Every page exists under src/app, and is there for a reason.
for (const [name, route] of Object.entries(APP_PAGES)) {
  const pathname = route.split(/[?#]/)[0]
  const page = path.join(root, 'src/app', pathname, 'page.tsx')
  assert.ok(fs.existsSync(page), `${name}: no page at ${pathname} (${page})`)
  const used = CAPABILITIES.some((capability) => capability.page === name || capability.does.includes(name))
  assert.ok(used, `${name} is a page no capability names`)
}
const pages = appPagesAt('https://app.example')
assert.deepEqual(Object.keys(pages).sort(), Object.keys(APP_PAGES).sort())
assert.equal(pages.offersToAnswer, 'https://app.example/opportunities?tab=new')

// What testers asked and the Rep did not know (#52, #48, #46, #25, #16).
for (const words of ['Telegram', 'connect_app', 'some offers', 'For later', 'from the US', 'Subir uno nuevo', 'notAvailableNow', 'never that you do not know']) {
  assert.ok(SYSTEM_PROMPT.includes(words), `the prompt no longer says «${words}»`)
}
