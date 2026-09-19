/**
 * Which chat is yours.
 *
 *   npm run telegram:whoami
 *
 * A Telegram chat id is not something a person knows about themselves. It
 * comes into existence the moment you message the bot, and then it is a
 * number in an API response that nobody should have to go and find by hand.
 * So: send the bot anything, run this, and it tells you.
 */

const token = process.env.AMBLE_TELEGRAM_BOT_TOKEN?.trim()

if (!token) {
  console.error('No AMBLE_TELEGRAM_BOT_TOKEN in .env.local.')
  console.error()
  console.error('Getting one takes two minutes and no account:')
  console.error('  1. Open Telegram and message @BotFather')
  console.error('  2. Send /newbot, give it a name and a username ending in "bot"')
  console.error('  3. It answers with a token like 123456:AAH...')
  console.error('  4. Put it in .env.local as AMBLE_TELEGRAM_BOT_TOKEN')
  console.error('  5. Message your new bot anything at all, then run this again')
  process.exit(1)
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
const body = await response.json().catch(() => null)

if (!body?.ok) {
  console.error(`Telegram refused it: ${body?.description ?? response.status}`)
  process.exit(1)
}

const chats = new Map()
for (const update of body.result ?? []) {
  const chat = update.message?.chat
  if (!chat) continue
  const name = [chat.first_name, chat.last_name, chat.username && `@${chat.username}`]
    .filter(Boolean)
    .join(' ')
  chats.set(String(chat.id), { name: name || String(chat.id), text: update.message.text ?? '' })
}

if (chats.size === 0) {
  console.log('The bot has no messages yet.')
  console.log('Open Telegram, find your bot, send it anything, and run this again.')
  console.log()
  console.log('(Telegram only keeps recent updates, so if you wrote days ago, write again.)')
  process.exit(0)
}

console.log('Chats that have written to the bot:')
console.log()
for (const [id, chat] of chats) {
  console.log(`  ${id.padEnd(14)} ${chat.name}`)
  if (chat.text) console.log(`  ${' '.repeat(14)} last said: "${chat.text.slice(0, 60)}"`)
}
console.log()
console.log('Put the number in the Telegram field on the listening screen.')
