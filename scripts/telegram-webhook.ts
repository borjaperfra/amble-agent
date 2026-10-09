// Points amble's Telegram bot at this environment's webhook, once per bot.
// Run with the environment's variables (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME,
// TELEGRAM_WEBHOOK_SECRET):
//
//   railway run --environment production --service app npm run telegram:webhook -- https://app.amble.fyi
//   railway run --environment staging --service app-staging npm run telegram:webhook -- https://<staging host>

import { dictionaries } from '../src/lib/i18n/dictionaries'
import { setCommands, setWebhook, telegramConfig } from '../src/lib/telegram/api'
import { COMMANDS } from '../src/lib/telegram/inbound'

async function main() {
  const base = process.argv[2]?.replace(/\/$/, '')
  const config = telegramConfig()
  if (!config) throw new Error('TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET are needed.')
  if (!base || !/^https:\/\//.test(base)) throw new Error('Give the https address of the app, e.g. https://app.amble.fyi')
  await setWebhook(config, `${base}/api/telegram/webhook`)
  console.log(`@${config.username} now delivers to ${base}/api/telegram/webhook`)
  // The «/» menu: Spanish by default, English for those whose Telegram is in English.
  const menu = (locale: 'es' | 'en') => COMMANDS.map((command) => ({ command, description: dictionaries[locale].whatsapp.commands[command] }))
  await setCommands(config, menu('es'))
  await setCommands(config, menu('en'), 'en')
  console.log(`commands: ${COMMANDS.map((command) => '/' + command).join(' ')}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
