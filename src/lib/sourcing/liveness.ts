import { getDb, inTransaction } from '../db/db'
import { now } from '../db/repo'
import { BlockedUrlError, safeFetchText } from '../net/safe-fetch'

// Whether an offer found through an aggregator is still open. A company's
// own board (Greenhouse, Workday…) is read whole each pass, and an offer
// missing from it closes there (closeMissing). An aggregator never says an
// offer closed: it only stops returning it, and amble closed it after 21
// days unseen. Meanwhile it was shown and sent, and people found it closed
// (2026-10-05, 2026-10-07: LinkedIn and Tecnoempleo links, both from
// TheirStack). So the link of each such offer someone is about to see is
// opened, once a day at most, a few seconds apart (LinkedIn answers 429
// after about ten in a row), and an offer its page says is closed closes.
//
// Closed is only what the page says plainly: gone (404, 410) or a notice
// the board writes on closed offers. Anything else (a block, an error, a
// page that says nothing) leaves it as it was.

const AGGREGATORS = ['theirstack', 'infojobs']
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const PER_PASS = 40
const GAP_MS = 2500
// A host that refuses this many in a row is left for the next pass.
const HOST_REFUSALS = 2

// Notices boards write on an offer that closed, lower case. Only whole
// sentences no open offer would carry.
const CLOSED_NOTICES = [
  'no longer accepting applications',
  'ya no se aceptan solicitudes',
  'this job has expired',
  'this job is no longer available',
  'this job posting is no longer available',
  'this position has been filled',
  'esta oferta ya no está disponible',
  'esta oferta ha caducado',
  'la oferta ha caducado',
  'esta oferta de empleo ha caducado',
]

export type LinkState = 'open' | 'closed' | 'unknown'

export function linkStateOf(status: number, body: string): LinkState {
  if (status === 404 || status === 410) return 'closed'
  if (status < 200 || status >= 300) return 'unknown'
  const text = body.toLowerCase()
  return CLOSED_NOTICES.some((notice) => text.includes(notice)) ? 'closed' : 'open'
}

export async function checkLink(url: string): Promise<{ state: LinkState; status: number | null }> {
  try {
    const response = await safeFetchText(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' },
      timeoutMs: 15_000,
    })
    return { state: linkStateOf(response.status, response.body), status: response.status }
  } catch (error) {
    // A page too large, of another type, or an address not allowed says nothing.
    if (!(error instanceof BlockedUrlError)) console.error('[liveness]', url, error instanceof Error ? error.message : error)
    return { state: 'unknown', status: null }
  }
}

interface Due {
  source: string
  external_id: string
  opportunity_id: string
  url: string
}

// The sightings to look at: open, from an aggregator, of an offer no
// company board lists, that someone was shown or is held for, not looked
// at in the last day; the most recently judged first.
function due(at: number): Due[] {
  const marks = AGGREGATORS.map(() => '?').join(', ')
  return getDb()
    .prepare(
      `SELECT s.source, s.external_id, s.opportunity_id, s.url
       FROM opportunity_sources s JOIN opportunities o ON o.id = s.opportunity_id
       WHERE s.source IN (${marks}) AND s.closed_at IS NULL AND o.closed_at IS NULL AND s.url IS NOT NULL
         AND (s.link_checked_at IS NULL OR s.link_checked_at < ?)
         AND NOT EXISTS (SELECT 1 FROM opportunity_sources b WHERE b.opportunity_id = s.opportunity_id AND b.closed_at IS NULL AND b.source NOT IN (${marks}))
         AND EXISTS (SELECT 1 FROM opportunity_matches m WHERE m.opportunity_id = s.opportunity_id AND m.verdict IN ('show', 'hold'))
       ORDER BY (SELECT MAX(m.created_at) FROM opportunity_matches m WHERE m.opportunity_id = s.opportunity_id) DESC
       LIMIT ?`,
    )
    .all(...AGGREGATORS, new Date(at - CHECK_EVERY_MS).toISOString(), ...AGGREGATORS, PER_PASS) as unknown as Due[]
}

// The sighting closes, for good (seen again, it stays closed: link_closed_at),
// and the offer with it when nothing else lists it.
export function closeByLink(source: string, externalId: string, opportunityId: string, at: string = now()): boolean {
  const db = getDb()
  let closed = false
  inTransaction(() => {
    db.prepare('UPDATE opportunity_sources SET closed_at = ?, link_closed_at = ?, link_checked_at = ? WHERE source = ? AND external_id = ?').run(
      at,
      at,
      at,
      source,
      externalId,
    )
    if (!db.prepare('SELECT 1 FROM opportunity_sources WHERE opportunity_id = ? AND closed_at IS NULL').get(opportunityId)) {
      closed = Number(db.prepare('UPDATE opportunities SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(at, opportunityId).changes) > 0
    }
  })
  return closed
}

export interface LivenessStats {
  checked: number
  closed: number
  unknown: number
  hostsRefusing: string[]
}

export async function checkOfferLinks(options: { until?: number; at?: number } = {}): Promise<LivenessStats> {
  const stats: LivenessStats = { checked: 0, closed: 0, unknown: 0, hostsRefusing: [] }
  const refusals = new Map<string, number>()
  const markChecked = getDb().prepare('UPDATE opportunity_sources SET link_checked_at = ? WHERE source = ? AND external_id = ?')
  for (const row of due(options.at ?? Date.now())) {
    if (options.until && Date.now() > options.until) break
    let host: string
    try {
      host = new URL(row.url).hostname
    } catch {
      continue
    }
    if ((refusals.get(host) ?? 0) >= HOST_REFUSALS) continue
    if (stats.checked > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS))
    const { state, status } = await checkLink(row.url)
    stats.checked++
    if (state === 'unknown') {
      stats.unknown++
      if (status === 429 || status === 403 || status === 999) refusals.set(host, (refusals.get(host) ?? 0) + 1)
      continue
    }
    refusals.set(host, 0)
    if (state === 'closed') {
      closeByLink(row.source, row.external_id, row.opportunity_id)
      stats.closed++
    } else {
      markChecked.run(now(), row.source, row.external_id)
    }
  }
  stats.hostsRefusing = [...refusals.entries()].filter(([, n]) => n >= HOST_REFUSALS).map(([host]) => host)
  return stats
}
