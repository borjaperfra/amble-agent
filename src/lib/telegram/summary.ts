import { issueAppLink } from '../auth/applinks'
import { getDb } from '../db/db'
import { candidateById, isSearchPaused } from '../db/repo'
import { candidateLocale } from '../i18n/candidate'
import { dictionaries } from '../i18n/dictionaries'
import { pinMessage, replaceText, sendText, telegramConfig, TelegramError } from './api'
import { telegramLinkOf } from './link'

// On Telegram, a summary of their search pinned at the top of the chat and
// changed where it is after every pass: what they were shown and wanted
// this week, what they kept for later, what they sent and who called. A new
// one is written and pinned only when there is none, or theirs was deleted.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function summaryText(candidateId: string): { text: string; buttons: { title: string; payload: string; url: string }[] } {
  const db = getDb()
  const candidate = candidateById(candidateId)
  const locale = candidateLocale(candidate)
  const w = dictionaries[locale].whatsapp.summary
  const since = new Date(Date.now() - WEEK_MS).toISOString()
  const count = (sql: string, ...values: string[]) => (db.prepare(sql).get(...values) as { n: number }).n
  const shown = count('SELECT COUNT(*) AS n FROM offer_releases WHERE candidate_id = ? AND released_at >= ?', candidateId, since)
  const wanted = count(
    `SELECT COUNT(*) AS n FROM opportunity_decisions WHERE candidate_id = ? AND decision IN ('interested', 'wanted_anyway') AND decided_at >= ?`,
    candidateId,
    since,
  )
  const later = count(`SELECT COUNT(*) AS n FROM opportunity_decisions WHERE candidate_id = ? AND decision = 'later'`, candidateId)
  const sent = count(`SELECT COUNT(*) AS n FROM opportunity_decisions WHERE candidate_id = ? AND progress = 'applied'`, candidateId)
  const called = count(`SELECT COUNT(DISTINCT opportunity_id) AS n FROM application_followups WHERE candidate_id = ? AND answer = 'called'`, candidateId)
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date())
  const lines = [
    w.title,
    '',
    w.week(shown, wanted),
    later > 0 ? w.later(later) : null,
    sent > 0 ? w.applied(sent, called) : null,
    isSearchPaused(candidateId) ? `\n${w.paused}` : null,
    '',
    w.updated(when),
  ]
  return {
    text: lines.filter((line): line is string => line !== null).join('\n'),
    // Into their own account: the links last two days, and the summary is
    // renewed every pass.
    buttons: [
      { title: w.offers, payload: '', url: issueAppLink(candidateId, '/opportunities') },
      { title: w.map, payload: '', url: issueAppLink(candidateId, '/me') },
    ],
  }
}

export async function refreshSummary(candidateId: string): Promise<void> {
  const config = telegramConfig()
  const link = config ? telegramLinkOf(candidateId) : null
  if (!config || !link) return
  const { text, buttons } = summaryText(candidateId)
  const db = getDb()
  const pinned = (db.prepare('SELECT summary_message_id AS id FROM telegram_links WHERE candidate_id = ?').get(candidateId) as { id: number | null } | undefined)?.id
  if (pinned) {
    try {
      await replaceText(config, link.chat_id, pinned, text, buttons)
      return
    } catch (error) {
      // The same words as before: nothing to change.
      if (error instanceof TelegramError && /not modified/i.test(error.message)) return
      // Deleted on their side, or too old to change: a new one below.
      if (!(error instanceof TelegramError && error.status === 400)) throw error
    }
  }
  const sent = await sendText(config, link.chat_id, text, buttons, { quiet: true })
  if (sent.messageId === null) return
  db.prepare('UPDATE telegram_links SET summary_message_id = ? WHERE candidate_id = ?').run(sent.messageId, candidateId)
  await pinMessage(config, link.chat_id, sent.messageId)
}

// After a pass, everyone on Telegram.
export async function refreshSummaries(): Promise<{ refreshed: number; failed: number }> {
  const stats = { refreshed: 0, failed: 0 }
  if (!telegramConfig()) return stats
  const ids = getDb().prepare('SELECT candidate_id FROM telegram_links').all() as { candidate_id: string }[]
  for (const { candidate_id: candidateId } of ids) {
    try {
      await refreshSummary(candidateId)
      stats.refreshed++
    } catch (error) {
      stats.failed++
      console.error('[telegram] summary not refreshed:', candidateId, error instanceof Error ? error.message : error)
    }
  }
  return stats
}
