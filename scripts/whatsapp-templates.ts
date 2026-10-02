// WhatsApp templates, from the terminal, against the account in ZERNIO_* (run
// with the server's variables: `railway run --service app npm run whatsapp:templates -- create <name>`).
//
//   npm run whatsapp:templates -- list      every template on the account, and its review status
//   npm run whatsapp:templates -- create <name>    submits that one to Meta, in every language (src/lib/whatsapp/templates.ts)
//
// One at a time, days apart: the day ten went in at once from a new number, Meta locked the account.
//
// Once they are APPROVED, AMBLE_WHATSAPP_TEMPLATES=1 on the server turns them on.

import { templateDefinitions } from '../src/lib/whatsapp/templates'
import { createTemplate, listTemplates, zernioConfig } from '../src/lib/whatsapp/zernio'

const config = zernioConfig()
if (!config) throw new Error('ZERNIO_API_KEY, ZERNIO_ACCOUNT_ID and ZERNIO_NUMBER are needed.')
if (config.sandbox) throw new Error('The shared test number takes no templates of ours.')

type Listed = { name?: string; language?: string; status?: string; category?: string }

async function existing(): Promise<Listed[]> {
  const result = (await listTemplates(config!)) as { data?: Listed[]; templates?: Listed[] } | Listed[]
  return Array.isArray(result) ? result : (result.data ?? result.templates ?? [])
}

const [command, only] = process.argv.slice(2)

async function main() {
  if (command === 'list') {
    console.table((await existing()).map((template) => ({ name: template.name, language: template.language, category: template.category, status: template.status })))
  } else if (command === 'create') {
    const names = [...new Set(templateDefinitions().map((template) => template.name))]
    if (!only || !names.includes(only)) throw new Error(`Name one template: ${names.join(' | ')}`)
    const there = new Set((await existing()).map((template) => `${template.name}:${template.language}`))
    for (const template of templateDefinitions().filter((template) => template.name === only)) {
      if (there.has(`${template.name}:${template.language}`)) {
        console.log(`already there: ${template.name} (${template.language})`)
        continue
      }
      await createTemplate(config!, template)
      console.log(`submitted: ${template.name} (${template.language})`)
    }
  } else {
    throw new Error('Commands: list | create')
  }
}

void main()
