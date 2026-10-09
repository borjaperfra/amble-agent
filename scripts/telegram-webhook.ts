// Points amble's Telegram bot at this environment's webhook, once per bot.
// Run with the environment's variables (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME,
// TELEGRAM_WEBHOOK_SECRET):
//
//   railway run --environment production --service app npm run telegram:webhook -- https://app.amble.fyi
//   railway run --environment staging --service app-staging npm run telegram:webhook -- https://<staging host>

import { setWebhook, telegramConfig } from '../src/lib/telegram/api'

async function main() {
  const base = process.argv[2]?.replace(/\/$/, '')
  const config = telegramConfig()
  if (!config) throw new Error('TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET are needed.')
  if (!base || !/^https:\/\//.test(base)) throw new Error('Give the https address of the app, e.g. https://app.amble.fyi')
  await setWebhook(config, `${base}/api/telegram/webhook`)
  console.log(`@${config.username} now delivers to ${base}/api/telegram/webhook`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
