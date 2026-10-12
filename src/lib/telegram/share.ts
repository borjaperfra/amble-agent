import { getDb } from '../db/db'
import { candidateById } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { answerInlineQuery, asTelegramHtml, type TelegramConfig } from './api'

// «@amble_fyi_bot …» typed in any chat, or «Compartir» on an offer: the
// offers amble showed them, to send to a friend as a message of their own.
// Only their own, found by their Telegram account; someone amble does not
// know is offered a way to connect, and sees nothing.

const RESULTS = 10
const SHARED_FROM = 'https://amble.fyi'

export interface InlineQuery {
  id: string
  from: { id: number }
  query?: string
}

interface SharedOffer {
  match_id: string
  title: string
  company: string
  location: string | null
  url: string | null
}

function offersOf(candidateId: string, query: string): SharedOffer[] {
  const db = getDb()
  const select = `SELECT m.id AS match_id, o.title, c.name AS company, o.location, o.url
    FROM opportunity_matches m JOIN opportunities o ON o.id = m.opportunity_id JOIN companies c ON c.id = o.company_id`
  // «Compartir» on a card asks for that one offer.
  const one = query.match(/^of:([\w-]+)$/)?.[1]
  if (one) return db.prepare(`${select} WHERE m.id = ? AND m.candidate_id = ?`).all(one, candidateId) as unknown as SharedOffer[]
  // Else the latest they were shown, those whose title or company has the words typed.
  const words = query.toLowerCase().trim()
  const rows = db
    .prepare(
      `${select} JOIN offer_releases r ON r.candidate_id = m.candidate_id AND r.opportunity_id = m.opportunity_id
       WHERE m.candidate_id = ? AND o.closed_at IS NULL
       GROUP BY m.opportunity_id ORDER BY r.released_at DESC LIMIT 100`,
    )
    .all(candidateId) as unknown as SharedOffer[]
  return rows.filter((row) => !words || `${row.title} ${row.company}`.toLowerCase().includes(words)).slice(0, RESULTS)
}

export async function answerShare(config: TelegramConfig, query: InlineQuery): Promise<void> {
  const link = getDb().prepare('SELECT candidate_id FROM telegram_links WHERE user_id = ?').get(String(query.from.id)) as { candidate_id: string } | undefined
  const candidate = link ? candidateById(link.candidate_id) : undefined
  const w = dictionaries[candidateLocale(candidate ?? null)].whatsapp
  if (!candidate) {
    await answerInlineQuery(config, query.id, [], { text: w.shareConnect, start_parameter: 'share' })
    return
  }
  const results = offersOf(candidate.id, (query.query ?? '').slice(0, 200)).map((offer) => {
    const where = [offer.company, offer.location?.split(' · ')[0]].filter(Boolean).join(' · ')
    const text = [`*${offer.title}*`, where, offer.url ? `\n${offer.url}` : null, `\n_${w.sharedWith(SHARED_FROM)}_`].filter((line) => line !== null).join('\n')
    return {
      type: 'article',
      id: offer.match_id,
      title: offer.title,
      description: where,
      input_message_content: { message_text: asTelegramHtml(text), parse_mode: 'HTML', link_preview_options: { is_disabled: !offer.url } },
      ...(offer.url ? { reply_markup: { inline_keyboard: [[{ text: w.offerButtons.open, url: offer.url }]] } } : {}),
    }
  })
  await answerInlineQuery(config, query.id, results, null)
}
