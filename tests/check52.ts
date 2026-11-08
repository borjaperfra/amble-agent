import assert from 'node:assert/strict'
import { getDb } from '../src/lib/db/db'
import { chatAppsOf, chatAvailability } from '../src/lib/channel/reach'
import { connectApp } from '../src/lib/whatsapp/actions'
import { saveTelegramLink, takeStartCode } from '../src/lib/telegram/link'
import { takeLinkCode } from '../src/lib/whatsapp/link'
import { dictionaries } from '../src/lib/i18n/dictionaries'

// Fake configs only: no request leaves (nothing here sends).
process.env.TELEGRAM_BOT_TOKEN = 'x'
process.env.TELEGRAM_BOT_USERNAME = '@amble_test_bot'
process.env.TELEGRAM_WEBHOOK_SECRET = 'x'
const msg = dictionaries.es.whatsapp.linkMessage
const db = getDb()
db.prepare("INSERT INTO candidates (id, name, created_at) VALUES ('c1', 'Ana', ?)").run(new Date().toISOString())

// Only Telegram configured: WhatsApp is unavailable, Telegram gives a working link.
assert.deepEqual(chatAppsOf('c1'), [{ app: 'telegram', connected: false }])
assert.equal(connectApp('c1', 'whatsapp', msg), 'unavailable')
const tg = connectApp('c1', 'telegram', msg)
assert.ok(typeof tg === 'object' && tg.url.startsWith('https://t.me/amble_test_bot?start='))
assert.equal(takeStartCode(`/start ${new URL(tg.url).searchParams.get('start')}`), 'c1')

// Connected: said so, no new link.
saveTelegramLink('c1', { chatId: '42', userId: null, username: null })
assert.equal(connectApp('c1', 'telegram', msg), 'connected')
assert.deepEqual(chatAvailability('c1'), { available: true, linked: true, on: 'telegram', apps: ['telegram'] })

// WhatsApp too: a wa.me link whose message carries a code that links them.
process.env.ZERNIO_API_KEY = 'x'
process.env.ZERNIO_ACCOUNT_ID = 'x'
process.env.ZERNIO_NUMBER = '+34 600 000 000'
const wa = connectApp('c1', 'whatsapp', msg)
assert.ok(typeof wa === 'object' && wa.url.startsWith('https://wa.me/34600000000?text='))
const text = decodeURIComponent(wa.url.split('text=')[1])
assert.equal(takeLinkCode(text, '34611111111'), 'c1')

// The map's words name the app.
assert.equal(dictionaries.es.map.gapsLater('Telegram'), 'De vez en cuando te mandaré una de estas preguntas por Telegram; contéstame a ese mensaje.')
assert.equal(dictionaries.es.map.chatApps(['WhatsApp', 'Telegram']), 'WhatsApp o Telegram')
console.log('ok #52')
